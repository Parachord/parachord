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

// Generate XSPF playlist XML from smart link data
export function generateXspf(data) {
  const escapeXml = (str) => {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  };

  const tracks = (data.tracks || []).map(t => `    <track>
      <title>${escapeXml(t.title)}</title>
      <creator>${escapeXml(t.artist || data.artist || '')}</creator>
      <album>${escapeXml(data.title || '')}</album>
      <duration>${Math.round((t.duration || 0) * 1000)}</duration>
    </track>`).join('\n');

  const date = data.createdAt ? new Date(data.createdAt).toISOString() : new Date().toISOString();

  return `<?xml version="1.0" encoding="UTF-8"?>
<playlist version="1" xmlns="http://xspf.org/ns/0/">
  <title>${escapeXml(data.title)}</title>
  <creator>${escapeXml(data.creator || data.artist || 'Parachord')}</creator>
  <date>${date}</date>
  <trackList>
${tracks}
  </trackList>
</playlist>`;
}

// Format duration in seconds to M:SS
function formatDuration(seconds) {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Generate service badge HTML for a track's resolver matches
function generateTrackBadgesHtml(trackUrls) {
  if (!trackUrls || typeof trackUrls !== 'object') return '';
  return SERVICES.map(s => {
    const url = trackUrls[s.id];
    if (!url) return '';
    return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="resolver-badge" style="--badge-color: ${s.color}" title="Open on ${s.name}">${SERVICE_ICONS[s.id]}</a>`;
  }).filter(Boolean).join('');
}

// Generate the tracklist HTML for albums/playlists
function generateTracklistHtml(tracks) {
  if (!tracks || !tracks.length) return '';
  return tracks.map((track, i) => {
    const num = track.trackNumber || (i + 1);
    const badges = generateTrackBadgesHtml(track.urls);
    const dur = formatDuration(track.duration);
    const artistHtml = track.artist ? `<span class="track-row-artist">${escapeHtml(track.artist)}</span>` : '';
    return `
      <div class="track-row">
        <div class="track-num-container">
          <span class="track-num">${num}</span>
          <button class="track-play-btn" onclick="playTrackInParachord(${i})" title="Play in Parachord">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          </button>
        </div>
        <div class="track-row-info">
          <span class="track-row-title">${escapeHtml(track.title)}</span>
          ${artistHtml}
        </div>
        <div class="track-row-badges">${badges}</div>
        ${dur ? `<span class="track-row-duration">${dur}</span>` : ''}
      </div>`;
  }).join('');
}

export function generateLinkPageHtml(data, linkId, baseUrl) {
  const { title, artist, albumArt, type, urls, tracks, creator } = data;
  const isPlaylist = type === 'playlist';
  const fullTitle = `${escapeHtml(title)}${artist ? ' - ' + escapeHtml(artist) : ''}`;
  const linkUrl = `${baseUrl}/${linkId}`;
  const isCollection = (type === 'album' || type === 'playlist') && tracks && tracks.length > 0;
  const typeLabel = isPlaylist ? 'Playlist' : (type === 'album' ? 'Album' : 'Track');
  const ogType = type === 'album' ? 'music.album' : (isPlaylist ? 'music.playlist' : 'music.song');

  // Service links - icon row for albums, full buttons for single tracks, none for playlists
  const serviceLinksHtml = (!isPlaylist && urls) ? SERVICES.map(s => {
    const url = urls[s.id];
    if (!url) return '';
    if (isCollection) {
      return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="service-icon-link" style="--service-color: ${s.color}" title="${s.name}">${SERVICE_ICONS[s.id]}</a>`;
    }
    return `
      <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="service-link" style="--service-color: ${s.color}">
        <span class="service-icon">${SERVICE_ICONS[s.id]}</span>
        <span class="service-name">${s.name}</span>
      </a>`;
  }).filter(Boolean).join('\n') : '';

  // For playlists, collect unique album art URLs for a 2x2 mosaic
  const playlistCovers = isPlaylist && tracks ? [...new Set(tracks.map(t => t.albumArt).filter(Boolean))].slice(0, 4) : [];

  // Tracklist for albums/playlists
  const tracklistHtml = isCollection ? generateTracklistHtml(tracks) : '';
  const trackCount = isCollection ? tracks.length : 0;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${fullTitle} | Listen Now</title>
  <link rel="icon" href="/favicon.ico" sizes="48x48">
  <link rel="icon" href="/icon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <meta property="og:title" content="${fullTitle}">
  <meta property="og:description" content="${isCollection ? `${typeLabel} · ${trackCount} tracks` : 'Listen on your favorite streaming service'}">
  <meta property="og:type" content="${ogType}">
  ${albumArt ? `<meta property="og:image" content="${escapeHtml(albumArt)}">` : ''}
  <meta property="og:url" content="${linkUrl}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${fullTitle}">
  <meta name="twitter:description" content="${isCollection ? `${typeLabel} · ${trackCount} tracks` : 'Listen on your favorite streaming service'}">
  ${albumArt ? `<meta name="twitter:image" content="${escapeHtml(albumArt)}">` : ''}
  <link rel="alternate" type="application/json+oembed"
        href="${baseUrl}/api/oembed?url=${encodeURIComponent(linkUrl)}"
        title="${fullTitle}">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg-primary: #0f0f0f;
      --bg-secondary: #1a1a1a;
      --bg-tertiary: #252525;
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
      ${isCollection ? 'justify-content: flex-start; padding: 40px 20px;' : 'justify-content: center; padding: 20px;'}
    }
    .container {
      max-width: ${isCollection ? '600px' : '400px'};
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
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 48px;
      color: var(--text-secondary);
    }
    .playlist-mosaic {
      width: 200px;
      height: 200px;
      border-radius: 8px;
      margin-bottom: 20px;
      display: inline-grid;
      grid-template-columns: 1fr 1fr;
      grid-template-rows: 1fr 1fr;
      overflow: hidden;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    }
    .playlist-mosaic img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    h1 {
      font-size: 1.5rem;
      margin-bottom: 8px;
      font-weight: 600;
    }
    .artist {
      color: var(--text-secondary);
      margin-bottom: 4px;
    }
    .type-label {
      color: var(--text-secondary);
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 24px;
    }
    .services {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .services-row {
      display: flex;
      justify-content: center;
      gap: 16px;
      margin-bottom: 8px;
    }
    .service-icon-link {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: var(--bg-secondary);
      display: flex;
      align-items: center;
      justify-content: center;
      text-decoration: none;
      transition: all 0.2s ease;
      border: 1px solid transparent;
    }
    .service-icon-link:hover {
      border-color: var(--service-color);
      transform: translateY(-2px);
      background: var(--bg-tertiary);
    }
    .service-icon-link svg {
      width: 22px;
      height: 22px;
      color: var(--service-color);
    }
    .service-icon-link img {
      width: 22px !important;
      height: 22px !important;
      object-fit: contain;
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
    /* Icon row for album/playlist service links */
    .services-row {
      display: flex;
      flex-direction: row;
      justify-content: center;
      gap: 16px;
      flex-wrap: wrap;
    }
    .service-icon-link {
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: var(--bg-secondary);
      display: flex;
      align-items: center;
      justify-content: center;
      text-decoration: none;
      transition: all 0.2s ease;
      border: 1px solid transparent;
    }
    .service-icon-link:hover {
      border-color: var(--service-color);
      background: color-mix(in srgb, var(--service-color) 15%, var(--bg-secondary));
      transform: translateY(-2px);
    }
    .service-icon-link svg {
      width: 22px;
      height: 22px;
      color: var(--service-color);
    }
    .service-icon-link img {
      width: 22px !important;
      height: 22px !important;
      object-fit: contain;
    }
    /* Tracklist styles */
    .tracklist {
      margin-top: 24px;
      text-align: left;
    }
    .tracklist-header {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--text-secondary);
      margin-bottom: 12px;
      padding: 0 12px;
    }
    .track-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 12px;
      border-radius: 6px;
      transition: background 0.15s ease;
    }
    .track-row:hover {
      background: var(--bg-secondary);
    }
    .track-num-container {
      width: 24px;
      flex-shrink: 0;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: flex-end;
    }
    .track-num {
      width: 24px;
      text-align: right;
      font-size: 0.8rem;
      color: var(--text-secondary);
      font-variant-numeric: tabular-nums;
    }
    .track-play-btn {
      display: none;
      position: absolute;
      inset: 0;
      background: none;
      border: none;
      cursor: pointer;
      color: var(--text-primary);
      padding: 0;
      align-items: center;
      justify-content: center;
    }
    .track-play-btn svg {
      width: 16px;
      height: 16px;
    }
    .track-play-btn:hover {
      color: var(--accent);
    }
    body.parachord-connected .track-row:hover .track-num {
      display: none;
    }
    body.parachord-connected .track-row:hover .track-play-btn {
      display: flex;
    }
    .track-row-info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .track-row-title {
      font-size: 0.9rem;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .track-row-artist {
      font-size: 0.8rem;
      color: var(--text-secondary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .track-row-badges {
      display: flex;
      gap: 6px;
      flex-shrink: 0;
    }
    .resolver-badge {
      width: 22px;
      height: 22px;
      border-radius: 4px;
      background: color-mix(in srgb, var(--badge-color) 20%, transparent);
      display: flex;
      align-items: center;
      justify-content: center;
      text-decoration: none;
      transition: all 0.15s ease;
    }
    .resolver-badge:hover {
      background: color-mix(in srgb, var(--badge-color) 40%, transparent);
      transform: scale(1.1);
    }
    .resolver-badge svg {
      width: 13px;
      height: 13px;
      color: var(--badge-color);
    }
    .resolver-badge img {
      width: 13px !important;
      height: 13px !important;
    }
    .track-row-duration {
      font-size: 0.8rem;
      color: var(--text-secondary);
      flex-shrink: 0;
      font-variant-numeric: tabular-nums;
      min-width: 36px;
      text-align: right;
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
    .xspf-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 10px 20px;
      background: var(--bg-secondary);
      color: var(--text-primary);
      border: 1px solid var(--bg-tertiary);
      border-radius: 8px;
      font-size: 0.9rem;
      font-weight: 500;
      text-decoration: none;
      transition: all 0.2s ease;
    }
    .xspf-btn:hover {
      border-color: var(--accent);
      transform: translateY(-2px);
    }
    .xspf-btn svg {
      width: 16px;
      height: 16px;
      color: var(--accent);
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
    ${isPlaylist && playlistCovers.length >= 4
      ? `<div class="playlist-mosaic">${playlistCovers.map(src => `<img src="${escapeHtml(src)}" alt="">`).join('')}</div>`
      : (albumArt
        ? `<img src="${escapeHtml(albumArt)}" alt="Album Art" class="album-art">`
        : `<div class="album-art-placeholder">${isCollection ? '♫' : '♪'}</div>`)
    }
    <h1>${escapeHtml(title)}</h1>
    ${isPlaylist && creator ? `<p class="artist">by ${escapeHtml(creator)}</p>` : (artist ? `<p class="artist">${escapeHtml(artist)}</p>` : '')}
    ${isCollection ? `<p class="type-label">${typeLabel} · ${trackCount} tracks</p>` : ''}

    ${serviceLinksHtml ? `<div class="${isCollection ? 'services-row' : 'services'}">${serviceLinksHtml}</div>` : ''}
    ${isPlaylist && isCollection ? `<div class="services-row"><a href="${linkUrl}/playlist.xspf" class="xspf-btn" download><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>.xspf</a></div>` : ''}

    ${isCollection ? `
    <div class="tracklist">
      <div class="tracklist-header">Tracklist</div>
      ${tracklistHtml}
    </div>
    ` : ''}

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
    const linkData = ${JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')};
    let ws = null;

    function connectToParachord() {
      try {
        ws = new WebSocket('ws://localhost:9876');
        ws.onopen = () => {
          document.getElementById('parachord-btn').classList.remove('hidden');
          document.body.classList.add('parachord-connected');
        };
        ws.onclose = () => {
          document.getElementById('parachord-btn').classList.add('hidden');
          document.body.classList.remove('parachord-connected');
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
        if (linkData.tracks && linkData.tracks.length > 0) {
          // For albums/playlists, send all individual tracks with album context
          const tracks = linkData.tracks.map(t => ({
            title: t.title,
            artist: t.artist || linkData.artist,
            album: linkData.title,
            albumArt: linkData.albumArt,
            duration: t.duration,
            trackNumber: t.trackNumber,
            urls: t.urls
          }));
          ws.send(JSON.stringify({ type: 'embed', action: 'play', payload: { track: tracks[0], queue: tracks.slice(1) } }));
        } else {
          ws.send(JSON.stringify({ type: 'embed', action: 'play', payload: { track: linkData } }));
        }
      }
    }

    function playTrackInParachord(index) {
      if (ws && ws.readyState === WebSocket.OPEN && linkData.tracks && linkData.tracks[index]) {
        const t = linkData.tracks[index];
        const track = {
          title: t.title,
          artist: t.artist || linkData.artist,
          album: linkData.title,
          albumArt: linkData.albumArt,
          duration: t.duration,
          trackNumber: t.trackNumber,
          urls: t.urls
        };
        ws.send(JSON.stringify({ type: 'embed', action: 'play', payload: { track } }));
      }
    }

    connectToParachord();
  </script>
</body>
</html>`;
}

export function generateLargeEmbedHtml(data, linkId, baseUrl) {
  const { title, artist, albumArt, type, urls, tracks, creator } = data;
  const linkUrl = `${baseUrl}/${linkId}`;
  const isPlaylist = type === 'playlist';
  const isCollection = (type === 'album' || type === 'playlist') && tracks && tracks.length > 0;
  const typeLabel = isPlaylist ? 'Playlist' : (type === 'album' ? 'Album' : 'Track');
  const trackCount = isCollection ? tracks.length : 0;
  const firstUrl = SERVICES.map(s => urls?.[s.id]).find(Boolean);

  // For playlists, collect unique album art URLs for a 2x2 mosaic
  const playlistCovers = isPlaylist && tracks ? [...new Set(tracks.map(t => t.albumArt).filter(Boolean))].slice(0, 4) : [];

  // Service icon links for albums (not playlists)
  const serviceLinksHtml = (!isPlaylist && urls) ? SERVICES.map(s => {
    const url = urls[s.id];
    if (!url) return '';
    return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="service-icon-link" style="--service-color: ${s.color}" title="${s.name}">${SERVICE_ICONS[s.id]}</a>`;
  }).filter(Boolean).join('\n') : '';

  const tracklistHtml = isCollection ? generateTracklistHtml(tracks) : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    :root {
      --bg-primary: #0f0f0f;
      --bg-secondary: #1a1a1a;
      --bg-tertiary: #252525;
      --text-primary: #ffffff;
      --text-secondary: #a0a0a0;
      --accent: #8b5cf6;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      overflow-y: auto;
    }
    .container {
      max-width: 600px;
      width: 100%;
      margin: 0 auto;
      text-align: center;
      padding: 24px 16px;
    }
    .album-art {
      width: 160px;
      height: 160px;
      border-radius: 8px;
      margin-bottom: 16px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      object-fit: cover;
    }
    .album-art-placeholder {
      width: 160px;
      height: 160px;
      border-radius: 8px;
      margin-bottom: 16px;
      background: var(--bg-secondary);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 40px;
      color: var(--text-secondary);
    }
    .playlist-mosaic {
      width: 160px;
      height: 160px;
      border-radius: 8px;
      margin-bottom: 16px;
      display: inline-grid;
      grid-template-columns: 1fr 1fr;
      grid-template-rows: 1fr 1fr;
      overflow: hidden;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    }
    .playlist-mosaic img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    h1 {
      font-size: 1.25rem;
      margin-bottom: 6px;
      font-weight: 600;
    }
    .artist-name {
      color: var(--text-secondary);
      margin-bottom: 4px;
      font-size: 0.9rem;
    }
    .type-label {
      color: var(--text-secondary);
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 16px;
    }
    .header-actions {
      display: flex;
      justify-content: center;
      gap: 8px;
      margin-bottom: 16px;
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
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .btn .play-icon {
      width: 14px;
      height: 14px;
      flex-shrink: 0;
    }
    .btn-primary {
      background: var(--accent);
      color: #fff;
    }
    .btn-primary:hover {
      filter: brightness(1.1);
    }
    .btn-secondary {
      background: var(--bg-tertiary);
      color: #fff;
    }
    .btn-secondary:hover {
      background: #333;
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
    .services-row {
      display: flex;
      justify-content: center;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 16px;
    }
    .service-icon-link {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: var(--bg-secondary);
      display: flex;
      align-items: center;
      justify-content: center;
      text-decoration: none;
      transition: all 0.2s ease;
      border: 1px solid transparent;
    }
    .service-icon-link:hover {
      border-color: var(--service-color);
      background: color-mix(in srgb, var(--service-color) 15%, var(--bg-secondary));
    }
    .service-icon-link svg {
      width: 18px;
      height: 18px;
      color: var(--service-color);
    }
    .service-icon-link img {
      width: 18px !important;
      height: 18px !important;
      object-fit: contain;
    }
    .tracklist {
      text-align: left;
    }
    .tracklist-header {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--text-secondary);
      margin-bottom: 8px;
      padding: 0 12px;
    }
    .track-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 12px;
      border-radius: 6px;
      transition: background 0.15s ease;
    }
    .track-row:hover {
      background: var(--bg-secondary);
    }
    .track-num-container {
      width: 24px;
      flex-shrink: 0;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: flex-end;
    }
    .track-num {
      width: 24px;
      text-align: right;
      font-size: 0.8rem;
      color: var(--text-secondary);
      font-variant-numeric: tabular-nums;
    }
    .track-play-btn {
      display: none;
      position: absolute;
      inset: 0;
      background: none;
      border: none;
      cursor: pointer;
      color: var(--text-primary);
      padding: 0;
      align-items: center;
      justify-content: center;
    }
    .track-play-btn svg {
      width: 16px;
      height: 16px;
    }
    .track-play-btn:hover {
      color: var(--accent);
    }
    body.parachord-connected .track-row:hover .track-num {
      display: none;
    }
    body.parachord-connected .track-row:hover .track-play-btn {
      display: flex;
    }
    .track-row-info {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .track-row-title {
      font-size: 0.85rem;
      font-weight: 500;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .track-row-artist {
      font-size: 0.75rem;
      color: var(--text-secondary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .track-row-badges {
      display: flex;
      gap: 5px;
      flex-shrink: 0;
    }
    .resolver-badge {
      width: 20px;
      height: 20px;
      border-radius: 4px;
      background: color-mix(in srgb, var(--badge-color) 20%, transparent);
      display: flex;
      align-items: center;
      justify-content: center;
      text-decoration: none;
      transition: all 0.15s ease;
    }
    .resolver-badge:hover {
      background: color-mix(in srgb, var(--badge-color) 40%, transparent);
      transform: scale(1.1);
    }
    .resolver-badge svg {
      width: 12px;
      height: 12px;
      color: var(--badge-color);
    }
    .resolver-badge img {
      width: 12px !important;
      height: 12px !important;
    }
    .track-row-duration {
      font-size: 0.75rem;
      color: var(--text-secondary);
      flex-shrink: 0;
      font-variant-numeric: tabular-nums;
      min-width: 32px;
      text-align: right;
    }
  </style>
</head>
<body>
  <div class="container">
    ${isPlaylist && playlistCovers.length >= 4
      ? `<div class="playlist-mosaic">${playlistCovers.map(src => `<img src="${escapeHtml(src)}" alt="">`).join('')}</div>`
      : (albumArt
        ? `<img src="${escapeHtml(albumArt)}" alt="Album Art" class="album-art">`
        : `<div class="album-art-placeholder">${isCollection ? '♫' : '♪'}</div>`)
    }
    <h1>${escapeHtml(title)}</h1>
    ${isPlaylist && creator ? `<p class="artist-name">by ${escapeHtml(creator)}</p>` : (artist ? `<p class="artist-name">${escapeHtml(artist)}</p>` : '')}
    ${isCollection ? `<p class="type-label">${typeLabel} · ${trackCount} tracks</p>` : ''}

    <div class="header-actions">
      <button id="play-btn" class="btn btn-primary" onclick="playAll()"><svg class="play-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>${isCollection ? 'Play All' : 'Play'}</button>
      <a href="${linkUrl}" target="_blank" class="btn btn-secondary">Open</a>
    </div>

    ${serviceLinksHtml ? `<div class="services-row">${serviceLinksHtml}</div>` : ''}

    ${isCollection ? `
    <div class="tracklist">
      <div class="tracklist-header">Tracklist</div>
      ${tracklistHtml}
    </div>
    ` : ''}
  </div>

  <script>
    const linkData = ${JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')};
    const fallbackUrl = ${JSON.stringify(firstUrl || '')};
    let ws = null;
    let parachordConnected = false;

    function updatePlayButton() {
      const btn = document.getElementById('play-btn');
      const playIcon = '<svg class="play-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
      if (parachordConnected) {
        btn.innerHTML = '<span class="status-dot"></span>' + playIcon + '${isCollection ? 'Play All' : 'Play'}';
        btn.classList.add('btn-connected');
      } else {
        btn.innerHTML = playIcon + '${isCollection ? 'Play All' : 'Play'}';
        btn.classList.remove('btn-connected');
      }
    }

    function connectToParachord() {
      try {
        ws = new WebSocket('ws://localhost:9876');
        ws.onopen = () => {
          parachordConnected = true;
          document.body.classList.add('parachord-connected');
          updatePlayButton();
        };
        ws.onclose = () => {
          parachordConnected = false;
          document.body.classList.remove('parachord-connected');
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

    function playAll() {
      if (parachordConnected && ws && ws.readyState === WebSocket.OPEN) {
        if (linkData.tracks && linkData.tracks.length > 0) {
          const tracks = linkData.tracks.map(t => ({
            title: t.title,
            artist: t.artist || linkData.artist,
            album: linkData.title,
            albumArt: linkData.albumArt,
            duration: t.duration,
            trackNumber: t.trackNumber,
            urls: t.urls
          }));
          ws.send(JSON.stringify({ type: 'embed', action: 'play', payload: { track: tracks[0], queue: tracks.slice(1) } }));
        } else {
          ws.send(JSON.stringify({ type: 'embed', action: 'play', payload: { track: linkData } }));
        }
      } else if (fallbackUrl) {
        window.open(fallbackUrl, '_blank');
      }
    }

    function playTrackInParachord(index) {
      if (ws && ws.readyState === WebSocket.OPEN && linkData.tracks && linkData.tracks[index]) {
        const t = linkData.tracks[index];
        const track = {
          title: t.title,
          artist: t.artist || linkData.artist,
          album: linkData.title,
          albumArt: linkData.albumArt,
          duration: t.duration,
          trackNumber: t.trackNumber,
          urls: t.urls
        };
        ws.send(JSON.stringify({ type: 'embed', action: 'play', payload: { track } }));
      }
    }

    connectToParachord();
  </script>
</body>
</html>`;
}

export function generateEmbedHtml(data, linkId, baseUrl) {
  const { title, artist, albumArt, type, urls, tracks } = data;
  const linkUrl = `${baseUrl}/${linkId}`;
  const isCollection = (type === 'album' || type === 'playlist') && tracks && tracks.length > 0;
  const typeLabel = type === 'playlist' ? 'Playlist' : (type === 'album' ? 'Album' : 'Track');

  // Find the first available service URL for fallback
  const firstUrl = SERVICES.map(s => urls?.[s.id]).find(Boolean);

  // For collections, show subtitle with track count
  const subtitle = isCollection
    ? `${artist ? escapeHtml(artist) + ' · ' : ''}${typeLabel} · ${tracks.length} tracks`
    : (artist ? escapeHtml(artist) : '');

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
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .btn .play-icon {
      width: 14px;
      height: 14px;
      flex-shrink: 0;
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
      : `<div class="art-placeholder">${isCollection ? '♫' : '♪'}</div>`
    }
    <div class="info">
      <div class="title">${escapeHtml(title)}</div>
      ${subtitle ? `<div class="artist">${subtitle}</div>` : ''}
      <div class="actions">
        <button id="play-btn" class="btn btn-primary" onclick="playTrack()"><svg class="play-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>${isCollection ? 'Play All' : 'Play'}</button>
        <a href="${linkUrl}" target="_blank" class="btn btn-secondary">${isCollection ? 'View Tracks' : 'More'}</a>
      </div>
    </div>
  </div>
  <script>
    const linkData = ${JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')};
    const fallbackUrl = ${JSON.stringify(firstUrl || '')};
    let ws = null;
    let parachordConnected = false;

    function updatePlayButton() {
      const btn = document.getElementById('play-btn');
      const playIcon = '<svg class="play-icon" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
      if (parachordConnected) {
        btn.innerHTML = '<span class="status-dot"></span>' + playIcon + '${isCollection ? 'Play All' : 'Play'}';
        btn.classList.add('btn-connected');
      } else {
        btn.innerHTML = playIcon + '${isCollection ? 'Play All' : 'Play'}';
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
        ws.send(JSON.stringify({ type: 'embed', action: 'play', payload: { track: linkData } }));
      } else if (fallbackUrl) {
        window.open(fallbackUrl, '_blank');
      }
    }

    connectToParachord();
  </script>
</body>
</html>`;
}
