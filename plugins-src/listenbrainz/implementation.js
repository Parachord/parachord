// Source of truth for plugins/listenbrainz.axe v1.3.0.
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
    // Shared by the songs pick and the weekly sort.
    const dateOf = (entry) => {
      const t = Date.parse((entry && entry.playlist && entry.playlist.date) || '');
      return Number.isFinite(t) ? t : 0;
    };
    // The songs pick is one step and the weekly sections another: a miss in the
    // first (no recommendation playlist, no known type) must not drop the
    // second, since the weekly rows live only on this page now. null = miss.
    const loadSongsSection = async () => {
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
      if (playlists.length === 0) return null;

      // Pick by playlist TYPE, not position. The list is newest first, and it
      // mixes Daily Jams (mostly artists the user already plays), Weekly Jams,
      // Weekly Exploration (the new-music one) and the yearly "Top Discoveries
      // of <year>" / "Top Missed Recordings of <year>" round-ups. Taking the
      // first entry usually played Daily Jams, and right after the yearly
      // round-ups it played "Top Discoveries", the user's own listening from
      // last year, as recommendations (the parachord#1021 mistake).
      // The type is the playlist's algorithm source_patch; the title is the
      // fallback for an entry without one (Home's Weekly Jams card matches on
      // the title too).
      const EXPLORATION_FRESH_MS = 14 * 24 * 60 * 60 * 1000;
      const typeOf = (entry) => {
        const pl = (entry && entry.playlist) || {};
        const ext = (pl.extension && pl.extension['https://musicbrainz.org/doc/jspf#playlist']) || {};
        const meta = (ext.additional_metadata && ext.additional_metadata.algorithm_metadata) || {};
        if (typeof meta.source_patch === 'string' && meta.source_patch) return meta.source_patch;
        const title = String(pl.title || '').toLowerCase();
        if (title.indexOf('weekly exploration') === 0) return 'weekly-exploration';
        if (title.indexOf('daily jams') === 0) return 'daily-jams';
        if (title.indexOf('weekly jams') === 0) return 'weekly-jams';
        return '';
      };
      const newestOf = (types) => playlists
        .filter(entry => types.indexOf(typeOf(entry)) !== -1)
        .sort((a, b) => dateOf(b) - dateOf(a))[0] || null;
      // Weekly Exploration while it's current; else the newest jams playlist;
      // else a stale Weekly Exploration (ListenBrainz stops making them for a
      // quiet account, and an old one still beats nothing). Never the yearly
      // round-ups or any type this doesn't know.
      const exploration = newestOf(['weekly-exploration']);
      const chosen = (exploration && Date.now() - dateOf(exploration) <= EXPLORATION_FRESH_MS ? exploration : null)
        || newestOf(['daily-jams', 'weekly-jams'])
        || exploration;
      if (!chosen) return null;
      const playlistId = (chosen.playlist && chosen.playlist.identifier || '').split('/').pop();
      if (!playlistId) return null;

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
      return { items };
    };
    const songsSection = await loadSongsSection();
    const sections = songsSection ? [songsSection] : [];

    // Weekly Exploration and Weekly Jams, the last four of each (the cards
    // Home used to build itself). They live in /playlists/createdfor, not
    // /playlists/recommendations. A failed request throws like the others:
    // an empty answer would be cached as "no weekly playlists".
    const createdForResponse = await fetchListenBrainz(`https://api.listenbrainz.org/1/user/${encodeURIComponent(username)}/playlists/createdfor?count=100`);
    if (!createdForResponse.ok) {
      throw new Error(`Failed to fetch ListenBrainz weekly playlists: ${createdForResponse.status}`);
    }
    const createdForData = await createdForResponse.json();
    const createdFor = (createdForData && createdForData.playlists) || [];
    const WEEK_LABELS = ['This Week', 'Last Week', '2 Weeks Ago', '3 Weeks Ago'];
    const weeklyItems = (titleNeedle, contextType, label) => createdFor
      .filter(e => String((e && e.playlist && e.playlist.title) || '').toLowerCase().includes(titleNeedle))
      .sort((a, b) => dateOf(b) - dateOf(a))
      .slice(0, 4)
      .map((e, i) => {
        const id = String(e.playlist.identifier || '').split('/').pop();
        if (!id) return null;
        return {
          type: 'playlist',
          id,
          name: WEEK_LABELS[i],
          url: `https://listenbrainz.org/playlist/${id}/`,
          weekly: { id, contextType, label, weekLabel: WEEK_LABELS[i], date: e.playlist.date }
        };
      })
      .filter(Boolean);
    const explorationItems = weeklyItems('weekly exploration', 'weekly-exploration', 'Weekly Exploration');
    const jamsItems = weeklyItems('weekly jams', 'weekly-jam', 'Weekly Jams');
    if (explorationItems.length) sections.push({ id: 'weekly-exploration', title: 'Weekly Exploration', items: explorationItems });
    if (jamsItems.length) sections.push({ id: 'weekly-jams', title: 'Weekly Jams', items: jamsItems });
    return { sections };
  },

  // The similarUsers capability: listeners whose taste is closest to the
  // user's, for the Recommendations page's Friends section. No username is a
  // miss ([]); a failed request throws so an outage is never cached as
  // "no similar listeners".
  getSimilarUsers: async function (config) {
    const username = config && config.username;
    if (!username) return [];
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
    const response = await fetchListenBrainz(`https://api.listenbrainz.org/1/user/${encodeURIComponent(username)}/similar-users`);
    if (!response.ok) {
      throw new Error(`Failed to fetch ListenBrainz similar users: ${response.status}`);
    }
    const data = await response.json();
    // The API wraps the list in { payload }; accept a bare array too.
    const rows = Array.isArray(data) ? data : ((data && data.payload) || []);
    return rows
      .filter(r => r && r.user_name)
      .map(r => ({ username: r.user_name, similarity: Number(r.similarity) || 0 }))
      .sort((a, b) => b.similarity - a.similarity);
  }
};
