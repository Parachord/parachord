// POST /api/create - Create a new smart link
import { enrichLinkData } from '../../lib/enrich.js';

export async function onRequestPost({ request, env, waitUntil }) {
  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  try {
    const data = await request.json();

    // Validate required fields
    if (!data.title) {
      return Response.json(
        { error: 'Missing required field: title' },
        { status: 400, headers: corsHeaders }
      );
    }

    const type = data.type || 'track';
    const isCollection = type === 'album' || type === 'playlist';

    // For albums/playlists, require tracks array; for tracks, require urls
    if (isCollection) {
      if (!data.tracks || !Array.isArray(data.tracks) || data.tracks.length === 0) {
        return Response.json(
          { error: 'Missing required field: tracks (albums/playlists must have at least one track)' },
          { status: 400, headers: corsHeaders }
        );
      }
    } else {
      if (!data.urls || Object.keys(data.urls).length === 0) {
        return Response.json(
          { error: 'Missing required field: urls (must have at least one service URL)' },
          { status: 400, headers: corsHeaders }
        );
      }
    }

    // Generate short ID
    const id = crypto.randomUUID().slice(0, 8);

    // Store link data
    const linkData = {
      title: data.title,
      artist: data.artist || null,
      creator: data.creator || null,
      albumArt: data.albumArt || null,
      type,
      urls: data.urls || null,
      createdAt: Date.now()
    };

    // Include tracks for albums/playlists
    if (isCollection && data.tracks) {
      linkData.tracks = data.tracks.map(t => ({
        title: t.title || 'Unknown',
        artist: t.artist || null,
        duration: t.duration || null,
        trackNumber: t.trackNumber || null,
        urls: t.urls || {},
        albumArt: t.albumArt || null
      }));
    }

    await env.LINKS.put(id, JSON.stringify(linkData));

    // Background enrichment: fill in missing service URLs using server-side resolvers
    // This runs after the response is sent so it doesn't slow down link creation
    waitUntil((async () => {
      try {
        const changed = await enrichLinkData(linkData, env);
        linkData.enrichedAt = Date.now();
        await env.LINKS.put(id, JSON.stringify(linkData));
      } catch (e) {
        // Enrichment is best-effort, don't fail the request
      }
    })());

    // Determine base URL from request or use default
    const url = new URL(request.url);
    const baseUrl = `${url.protocol}//${url.host}`;

    return Response.json({
      id,
      url: `${baseUrl}/${id}`
    }, { headers: corsHeaders });

  } catch (error) {
    return Response.json(
      { error: 'Invalid request body' },
      { status: 400, headers: corsHeaders }
    );
  }
}

// Handle CORS preflight
export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
  });
}
