// Server-side enrichment: resolve missing service URLs for smart links
// Runs in Cloudflare Workers - uses free APIs (iTunes, YouTube) and
// Spotify Client Credentials flow (if SPOTIFY_CLIENT_ID/SECRET configured)

const SERVICES_TO_ENRICH = ['appleMusic', 'spotify', 'youtube'];

// --- Spotify Client Credentials ---
let spotifyTokenCache = { token: null, expiresAt: 0 };

async function getSpotifyToken(env) {
  if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) return null;
  if (spotifyTokenCache.token && Date.now() < spotifyTokenCache.expiresAt) {
    return spotifyTokenCache.token;
  }
  try {
    const resp = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + btoa(env.SPOTIFY_CLIENT_ID + ':' + env.SPOTIFY_CLIENT_SECRET)
      },
      body: 'grant_type=client_credentials'
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    spotifyTokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in - 60) * 1000
    };
    return data.access_token;
  } catch (e) {
    return null;
  }
}

async function searchSpotify(query, token) {
  try {
    const resp = await fetch(
      `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=5`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.tracks?.items || []).map(t => ({
      title: t.name,
      artist: t.artists.map(a => a.name).join(', '),
      album: t.album?.name,
      url: t.external_urls?.spotify,
      albumUrl: t.album?.external_urls?.spotify
    }));
  } catch (e) {
    return [];
  }
}

// --- iTunes (Apple Music) ---
async function searchItunes(query) {
  try {
    const resp = await fetch(
      `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=music&entity=song&limit=5`
    );
    if (!resp.ok) return [];
    const data = await resp.json();
    return (data.results || []).map(t => ({
      title: t.trackName,
      artist: t.artistName,
      album: t.collectionName,
      url: t.trackViewUrl,
      albumUrl: t.collectionViewUrl
    }));
  } catch (e) {
    return [];
  }
}

// --- YouTube (HTML regex - no DOM needed) ---
async function searchYouTube(query) {
  try {
    const resp = await fetch(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(query + ' music')}&sp=EgIQAQ%253D%253D`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' } }
    );
    if (!resp.ok) return [];
    const html = await resp.text();
    const results = [];
    const re = /"videoId":"([^"]+)","thumbnail".*?"title":\{"runs":\[\{"text":"([^"]+)"\}\].*?"ownerText":\{"runs":\[\{"text":"([^"]+)"/g;
    let match;
    while ((match = re.exec(html)) !== null && results.length < 5) {
      const [, videoId, title, channel] = match;
      if (videoId && title) {
        results.push({
          title,
          artist: channel,
          url: `https://www.youtube.com/watch?v=${videoId}`
        });
      }
    }
    return results;
  } catch (e) {
    return [];
  }
}

// --- Matching ---
function normalize(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findBestMatch(results, title, artist) {
  const normTitle = normalize(title);
  const normArtist = normalize(artist);
  // Exact match
  for (const r of results) {
    if (normalize(r.title) === normTitle && normalize(r.artist).includes(normArtist)) {
      return r;
    }
  }
  // Fuzzy: title contains and artist contains
  for (const r of results) {
    if (normalize(r.title).includes(normTitle) && normalize(r.artist).includes(normArtist)) {
      return r;
    }
  }
  // Title match with loose artist
  for (const r of results) {
    if (normalize(r.title).includes(normTitle) || normTitle.includes(normalize(r.title))) {
      if (normalize(r.artist).includes(normArtist) || normArtist.includes(normalize(r.artist))) {
        return r;
      }
    }
  }
  return null;
}

// --- Main enrichment ---
export async function enrichLinkData(data, env) {
  if (!data) return false;
  let changed = false;

  const spotifyToken = await getSpotifyToken(env);

  if (data.type === 'track' || (!data.tracks && data.urls)) {
    // Single track enrichment
    changed = await enrichTrackUrls(data, data.title, data.artist, spotifyToken);
  } else if (data.tracks && data.tracks.length > 0) {
    // Collection: enrich each track + top-level URLs
    const artist = data.artist || '';
    const promises = data.tracks.map(async (track) => {
      const trackArtist = track.artist || artist;
      const trackChanged = await enrichTrackUrls(track, track.title, trackArtist, spotifyToken);
      return trackChanged;
    });
    const results = await Promise.all(promises);
    if (results.some(Boolean)) changed = true;

    // Enrich top-level album/playlist URLs
    if (data.type === 'album' && data.urls) {
      const topChanged = await enrichAlbumUrls(data, data.title, artist, spotifyToken);
      if (topChanged) changed = true;
    }
  }

  return changed;
}

async function enrichTrackUrls(trackObj, title, artist, spotifyToken) {
  if (!title) return false;
  if (!trackObj.urls) trackObj.urls = {};

  const missing = SERVICES_TO_ENRICH.filter(s => !trackObj.urls[s]);
  if (missing.length === 0) return false;

  const query = `${artist || ''} ${title}`.trim();
  let changed = false;

  const searches = [];
  if (missing.includes('appleMusic')) searches.push(searchItunes(query).then(r => ({ service: 'appleMusic', results: r })));
  if (missing.includes('spotify') && spotifyToken) searches.push(searchSpotify(query, spotifyToken).then(r => ({ service: 'spotify', results: r })));
  if (missing.includes('youtube')) searches.push(searchYouTube(query).then(r => ({ service: 'youtube', results: r })));

  const resolved = await Promise.all(searches);

  for (const { service, results } of resolved) {
    const match = findBestMatch(results, title, artist || '');
    if (match && match.url) {
      trackObj.urls[service] = match.url;
      changed = true;
    }
  }

  return changed;
}

async function enrichAlbumUrls(albumObj, title, artist, spotifyToken) {
  if (!title || !albumObj.urls) return false;

  const missing = SERVICES_TO_ENRICH.filter(s => s !== 'youtube' && !albumObj.urls[s]);
  if (missing.length === 0) return false;

  const query = `${artist || ''} ${title}`.trim();
  let changed = false;

  const searches = [];
  if (missing.includes('appleMusic')) searches.push(searchItunes(query).then(r => ({ service: 'appleMusic', results: r })));
  if (missing.includes('spotify') && spotifyToken) searches.push(searchSpotify(query, spotifyToken).then(r => ({ service: 'spotify', results: r })));

  const resolved = await Promise.all(searches);

  for (const { service, results } of resolved) {
    const match = findBestMatch(results, title, artist || '');
    if (match && match.albumUrl) {
      albumObj.urls[service] = match.albumUrl;
      changed = true;
    }
  }

  return changed;
}
