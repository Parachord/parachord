// GET /api/lookup?id=<shortId> — resolve a smart link back to its stored payload.
// The read-side counterpart to create.js: the iOS app calls this when a user
// opens go.parachord.com/<id> so it can dispatch the in-app action (mobile #138).
// Returns the raw stored payload as-is (the same shape create.js wrote to KV):
// { title, artist, creator, albumArt, type, urls, tracks, deeplink, createdAt, enrichedAt }.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestGet({ request, env }) {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) {
    return Response.json({ error: 'Missing id' }, { status: 400, headers: CORS });
  }

  const raw = await env.LINKS.get(id);
  if (!raw) {
    return Response.json({ error: 'Not found' }, { status: 404, headers: CORS });
  }

  // Pass the stored JSON through verbatim (it's already a JSON string in KV).
  return new Response(raw, { headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// CORS preflight (mirrors create.js).
export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}
