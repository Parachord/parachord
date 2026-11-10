// Source of truth for plugins/lastfm.axe v1.1.0.
// Imported from the .axe by `node scripts/build-axes.js --import`.
// Edit here, bump manifest.version in manifest.json, then run `node scripts/build-axes.js`.
// The functions materialize fully isolated (resolver-loader.js uses
// new Function) — no shared scope between them; helpers must be embedded per function.
module.exports = {
  // The recommendations capability: the user's Last.fm recommended station
  // (the website's recommended-station JSON — not a documented API method, no
  // API key needed) as one untitled section of song items, which the
  // Recommendations page renders in its generic Songs bucket. The fetch used
  // to live in app.js (loadLastfmRecommendations); it moved here so the page
  // is provider-driven through the plugin capability.
  // Miss policy: no username or an empty station answers { sections: [] }
  // (a miss, not an error); a failed request also answers [] rather than
  // throwing, since the page shows the other providers' sections either way.
  getRecommendations: async function (config) {
    const username = config && config.username;
    if (!username) return { sections: [] };
    // A failed request THROWS (the page keeps the other providers and re-asks
    // next visit — an empty answer is never cached): a network blip must not
    // read as "Last.fm has nothing for you". The recommended-station JSON
    // answers 404 for a user with no recommendations — that is a miss ([]).
    const response = await fetch(`https://www.last.fm/player/station/user/${encodeURIComponent(username)}/recommended`);
    if (!response.ok) {
      if (response.status === 404) return { sections: [] };
      throw new Error(`Failed to fetch Last.fm recommendations: ${response.status}`);
    }
    const data = await response.json();
    const playlist = (data && data.playlist) || [];
    const items = [];
    for (const track of playlist) {
      const artist = (track && track.artists && track.artists[0]) || {};
      const title = (track && (track.name || track._name)) || null;
      if (!title) continue;
      items.push({
        type: 'song',
        id: (track && track.spelling_id) || `lastfm-rec-${title}`,
        name: title,
        artist: artist.name || artist._name || 'Unknown Artist',
        duration: (track && track.duration) || null
      });
    }
    return { sections: [{ items }] };
  }
};
