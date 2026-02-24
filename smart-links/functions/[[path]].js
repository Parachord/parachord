// Dynamic route handler for /:id and /:id/embed
import { generateLinkPageHtml, generateEmbedHtml } from '../lib/html.js';

// Static file extensions to pass through to assets
const STATIC_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.css', '.js', '.woff', '.woff2'];

export async function onRequestGet({ params, request, env }) {
  const pathParts = params.path || [];
  const fullPath = '/' + pathParts.join('/');

  // Check if this is a static file request - pass through to assets
  if (STATIC_EXTENSIONS.some(ext => fullPath.toLowerCase().endsWith(ext))) {
    return env.ASSETS.fetch(request);
  }

  // Handle /:id.xspf
  if (pathParts.length === 1 && pathParts[0].endsWith('.xspf')) {
    const id = pathParts[0].slice(0, -5); // strip .xspf
    return handleXspf(id, request, env);
  }

  // Handle /:id/embed
  if (pathParts.length === 2 && pathParts[1] === 'embed') {
    return handleEmbed(pathParts[0], request, env);
  }

  // Handle /:id
  if (pathParts.length === 1) {
    return handleLinkPage(pathParts[0], request, env);
  }

  return new Response('Not Found', { status: 404 });
}

async function handleLinkPage(id, request, env) {
  const data = await env.LINKS.get(id, 'json');

  if (!data) {
    return new Response(notFoundHtml(), {
      status: 404,
      headers: { 'Content-Type': 'text/html' }
    });
  }

  // Increment view count (fire and forget)
  incrementViews(id, data, env);

  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  return new Response(generateLinkPageHtml(data, id, baseUrl), {
    headers: {
      'Content-Type': 'text/html',
      'Cache-Control': 'public, max-age=300' // 5 min cache
    }
  });
}

async function handleEmbed(id, request, env) {
  const data = await env.LINKS.get(id, 'json');

  if (!data) {
    return new Response('Not Found', { status: 404 });
  }

  const url = new URL(request.url);
  const baseUrl = `${url.protocol}//${url.host}`;

  return new Response(generateEmbedHtml(data, id, baseUrl), {
    headers: {
      'Content-Type': 'text/html',
      'Cache-Control': 'public, max-age=300',
      'X-Frame-Options': 'ALLOWALL' // Allow embedding
    }
  });
}

function escapeXml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

async function handleXspf(id, request, env) {
  const data = await env.LINKS.get(id, 'json');

  if (!data) {
    return new Response('Not Found', { status: 404 });
  }

  if (data.type !== 'album' && data.type !== 'playlist') {
    // For single tracks, wrap it as a one-track playlist
    const trackLocation = data.urls?.spotify || data.urls?.youtube || data.urls?.appleMusic
      || data.urls?.soundcloud || data.urls?.bandcamp || data.urls?.tidal || data.urls?.deezer || '';
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<playlist version="1" xmlns="http://xspf.org/ns/0/">
  <title>${escapeXml(data.title)}</title>
  ${data.artist ? `<creator>${escapeXml(data.artist)}</creator>` : ''}
  ${data.albumArt ? `<image>${escapeXml(data.albumArt)}</image>` : ''}
  <trackList>
    <track>
      <title>${escapeXml(data.title)}</title>
      ${data.artist ? `<creator>${escapeXml(data.artist)}</creator>` : ''}
      ${trackLocation ? `<location>${escapeXml(trackLocation)}</location>` : ''}
      ${data.albumArt ? `<image>${escapeXml(data.albumArt)}</image>` : ''}
    </track>
  </trackList>
</playlist>`;

    return new Response(xml, {
      headers: {
        'Content-Type': 'application/xspf+xml',
        'Cache-Control': 'public, max-age=300'
      }
    });
  }

  // Album or playlist
  const tracks = (data.tracks || []).map(t => {
    const location = t.urls?.spotify || t.urls?.youtube || t.urls?.appleMusic
      || t.urls?.soundcloud || t.urls?.bandcamp || t.urls?.tidal || t.urls?.deezer || '';
    const artist = t.artist || data.artist;
    return `    <track>
      <title>${escapeXml(t.title)}</title>
      ${artist ? `<creator>${escapeXml(artist)}</creator>` : ''}
      ${location ? `<location>${escapeXml(location)}</location>` : ''}
      ${data.albumArt ? `<image>${escapeXml(data.albumArt)}</image>` : ''}
      ${t.duration ? `<duration>${Math.round(t.duration * 1000)}</duration>` : ''}
      ${t.trackNumber != null ? `<trackNum>${t.trackNumber}</trackNum>` : ''}
      ${t.urls?.spotify ? `<link rel="https://open.spotify.com">${escapeXml(t.urls.spotify)}</link>` : ''}
      ${t.urls?.appleMusic ? `<link rel="https://music.apple.com">${escapeXml(t.urls.appleMusic)}</link>` : ''}
      ${t.urls?.youtube ? `<link rel="https://youtube.com">${escapeXml(t.urls.youtube)}</link>` : ''}
    </track>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<playlist version="1" xmlns="http://xspf.org/ns/0/">
  <title>${escapeXml(data.title)}</title>
  ${data.artist ? `<creator>${escapeXml(data.artist)}</creator>` : ''}
  ${data.albumArt ? `<image>${escapeXml(data.albumArt)}</image>` : ''}
  <trackList>
${tracks}
  </trackList>
</playlist>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xspf+xml',
      'Cache-Control': 'public, max-age=300'
    }
  });
}

async function incrementViews(id, data, env) {
  try {
    data.views = (data.views || 0) + 1;
    await env.LINKS.put(id, JSON.stringify(data));
  } catch (e) {
    // Ignore errors for view counting
  }
}

function notFoundHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Link Not Found | Parachord</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f0f0f;
      color: #fff;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 20px;
    }
    h1 { font-size: 2rem; margin-bottom: 12px; }
    p { color: #a0a0a0; margin-bottom: 24px; }
    a {
      color: #8b5cf6;
      text-decoration: none;
    }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div>
    <h1>Link Not Found</h1>
    <p>This link may have expired or never existed.</p>
    <a href="https://parachord.app">Go to Parachord</a>
  </div>
</body>
</html>`;
}
