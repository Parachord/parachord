// Source of truth for plugins/listenbrainz.axe v1.1.0.
// Imported from the .axe by `node scripts/build-axes.js --import`.
// Edit here, bump manifest.version in manifest.json, then run `node scripts/build-axes.js`.
// The functions materialize fully isolated (resolver-loader.js uses
// new Function) — no shared scope between them; helpers must be embedded per function.
module.exports = {
  // The recommendations capability: the user's ListenBrainz recommendation
  // playlist (no fallback to their own most-played tracks — that showed the
  // user's history as if it were recommendations, parachord#1021) as one
  // untitled section of song items, which the Recommendations page renders in
  // its generic Songs bucket. The fetch used to live in app.js
  // (loadListenbrainzRecommendations); it moved here so the page is
  // provider-driven through the plugin capability.
  // Miss policy: no username or no recommendation playlist yet answers
  // { sections: [] } (a miss, not an error — parachord#1021); a failed
  // request throws, so the page keeps the other providers' sections and
  // re-asks next visit instead of caching the blip as an empty answer.
  getRecommendations: async function (config) {
    const username = config && config.username;
    if (!username) return { sections: [] };
    // Inline retry helper (functions materialize isolated): retry 429/503
    // with 1.5s, 3s, 6s waits, the same backoff the app's other ListenBrainz
    // fetches use.
    const fetchListenBrainz = async (url) => {
      const maxRetries = 3;
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          const response = await fetch(url);
          if (response.ok) return response;
          if (response.status === 429 || response.status === 503) {
            const delay = Math.pow(2, attempt) * 1500;
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
          return response;
        } catch (networkError) {
          if (attempt < maxRetries - 1) {
            const delay = Math.pow(2, attempt) * 1500;
            await new Promise(resolve => setTimeout(resolve, delay));
          } else {
            throw networkError;
          }
        }
      }
      return fetch(url);
    };
    // A failed request THROWS (the page keeps the other providers and re-asks
    // next visit — an empty answer is never cached): a network blip must not
    // read as "ListenBrainz has nothing for you". No recommendation playlist
    // yet is a miss ([]), never an error (parachord#1021).
    const playlistsResponse = await fetchListenBrainz(`https://api.listenbrainz.org/1/user/${encodeURIComponent(username)}/playlists/recommendations`);
    if (!playlistsResponse.ok) {
      throw new Error(`Failed to fetch ListenBrainz recommendations: ${playlistsResponse.status}`);
    }
    const playlistsData = await playlistsResponse.json();
    const playlists = (playlistsData && playlistsData.playlists) || [];
    if (playlists.length === 0) return { sections: [] };

    // The most recent recommendation playlist
    const latestPlaylist = playlists[0];
    const playlistId = (latestPlaylist.playlist && latestPlaylist.playlist.identifier || '').split('/').pop();
    if (!playlistId) return { sections: [] };

    const playlistResponse = await fetchListenBrainz(`https://api.listenbrainz.org/1/playlist/${playlistId}`);
    if (!playlistResponse.ok) {
      throw new Error(`Failed to fetch the ListenBrainz recommendation playlist: ${playlistResponse.status}`);
    }
    const playlistData = await playlistResponse.json();
    const tracks = (playlistData.playlist && playlistData.playlist.track) || [];

    const items = [];
    for (const track of tracks) {
      const title = track && track.title;
      if (!title) continue;
      const mbid = (track.identifier && track.identifier[0] || '').split('/').pop() || null;
      items.push({
        type: 'song',
        // A recording MBID is the stable id; without one there is no id at
        // all — the model falls back to trackSlug(artist, title), so two
        // songs sharing a title by different artists never share an id.
        id: mbid || undefined,
        name: title,
        artist: (track && track.creator) || 'Unknown Artist',
        duration: track && track.duration ? Math.floor(track.duration / 1000) : null,
        // The recording MBID rides on the item and the model's track, so
        // MBID enrichment and pickTrackMatch's exact-MBID tier work without
        // asking the mapper for the same recording again.
        mbid
      });
    }
    return { sections: [{ items }] };
  }
};
