// GET /api/oembed - oEmbed endpoint for rich embeds

export async function onRequestGet({ request, env }) {
  const requestUrl = new URL(request.url);
  const linkUrl = requestUrl.searchParams.get('url');
  const format = requestUrl.searchParams.get('format') || 'json';

  if (!linkUrl) {
    return Response.json(
      { error: 'Missing required parameter: url' },
      { status: 400 }
    );
  }

  // Only support JSON format
  if (format !== 'json') {
    return Response.json(
      { error: 'Only JSON format is supported' },
      { status: 501 }
    );
  }

  // Extract ID from URL
  // Supports: https://domain.com/abc123 or https://domain.com/abc123/embed
  const urlParts = new URL(linkUrl).pathname.split('/').filter(Boolean);
  const id = urlParts[0];

  if (!id) {
    return Response.json(
      { error: 'Invalid URL format' },
      { status: 400 }
    );
  }

  // Fetch link data from KV
  const data = await env.LINKS.get(id, 'json');

  if (!data) {
    return Response.json(
      { error: 'Link not found' },
      { status: 404 }
    );
  }

  const baseUrl = `${requestUrl.protocol}//${requestUrl.host}`;
  const fullTitle = `${data.title}${data.artist ? ' - ' + data.artist : ''}`;

  // Return oEmbed response
  return Response.json({
    version: '1.0',
    type: 'rich',
    provider_name: 'Parachord',
    provider_url: 'https://parachord.app',
    title: fullTitle,
    author_name: data.artist || undefined,
    thumbnail_url: data.albumArt || undefined,
    thumbnail_width: data.albumArt ? 300 : undefined,
    thumbnail_height: data.albumArt ? 300 : undefined,
    html: `<iframe src="${baseUrl}/${id}/embed" width="400" height="152" frameborder="0" allowtransparency="true" allow="encrypted-media" style="border-radius: 8px;"></iframe>`,
    width: 400,
    height: 152
  }, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600'
    }
  });
}
