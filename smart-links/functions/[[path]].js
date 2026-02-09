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
