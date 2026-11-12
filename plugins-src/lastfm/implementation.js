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
  // (a miss, not an error); a failed request throws — the page keeps the other
  // providers' sections and re-asks next visit, and an empty answer is never
  // cached as if Last.fm had nothing (parachord#1021's rule).
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
        // spelling_id is Last.fm's stable id; without one there is no id at
        // all — the model falls back to trackSlug(artist, title), so two songs
        // sharing a title by different artists never share an id.
        id: (track && track.spelling_id) || undefined,
        name: title,
        artist: artist.name || artist._name || 'Unknown Artist',
        duration: (track && track.duration) || null
      });
    }
    return { sections: [{ items }] };
  },

  // The similarUsers capability: people who listen like you, worked out from
  // friends-of-friends because Last.fm has no lookup for it (user.getNeighbours,
  // user.getSimilar, artist.getTopFans and tasteometer.compare all answered
  // "Invalid Method" on 2026-11-11). Spec: "Last.fm: worked out from
  // friends-of-friends". Candidates are friends of your friends (ranked by how
  // many of your friends know them, top 40), scored by shared top artists: a
  // binary cosine over the two 6-month top-50 artist-name sets,
  // shared / sqrt(|a| * |b|) with names lowercased; under 0.06 is dropped
  // (3 shared of 50 each). A rank-weighted cosine scored a real account's
  // candidates all under 0.05 (an artist shared far down both lists counted
  // for almost nothing), so the row came back empty; the binary score and the
  // 40-candidate check are the maintainer's call (2026-11-12).
  // A failed request or error body throws (the page keeps what it has and
  // caches nothing empty); only "you have no friends" is a miss ([]).
  // Isolated (new Function): the pacer, fetch wrapper and cosine live inside.
  // The API key is only ever encoded into request URLs, never into a message.
  getSimilarUsers: async function (config) {
    const username = config && config.username;
    const apiKey = config && config.apiKey;
    if (!username || !apiKey) return [];
    const exclude = new Set(((config && config.excludeUsernames) || []).map((u) => String(u).toLowerCase()));
    const selfName = String(username).toLowerCase();

    // Serial pacer: no more than 4 requests start in any 1000ms window
    // (the plugin's fetch skips the app's lastfmFetch, so it paces itself).
    const starts = [];
    const pace = async () => {
      for (;;) {
        const now = Date.now();
        while (starts.length && now - starts[0] >= 1000) starts.shift();
        if (starts.length < 4) { starts.push(now); return; }
        await new Promise((resolve) => setTimeout(resolve, 1000 - (now - starts[0])));
      }
    };

    // Returns { data } or { missing: true } for "user has nothing here"
    // (error 6 / 17 / 404); anything else throws, naming only the method.
    const call = async (method, user, extra) => {
      await pace();
      const url = 'https://ws.audioscrobbler.com/2.0/?method=' + method +
        '&user=' + encodeURIComponent(user) +
        '&api_key=' + encodeURIComponent(apiKey) + '&format=json' + extra;
      const response = await fetch(url);
      let data = null;
      try { data = await response.json(); } catch (e) { data = null; }
      const code = data && data.error;
      if (code === 6 || code === 17 || (!response.ok && response.status === 404)) return { missing: true };
      if (!response.ok) throw new Error('Last.fm ' + method + ' failed: ' + response.status);
      if (code) throw new Error('Last.fm ' + method + ' error ' + code);
      return { data };
    };

    const sizeOrder = ['small', 'medium', 'large', 'extralarge'];
    const parseFriends = (data) => {
      let list = data && data.friends && data.friends.user;
      if (!list) return [];
      if (!Array.isArray(list)) list = [list];
      return list.filter((u) => u && u.name).map((u) => {
        let best = null; let bestRank = -1;
        for (const img of (Array.isArray(u.image) ? u.image : [])) {
          const url = img && img['#text'];
          if (!url) continue;
          const r = sizeOrder.indexOf(img.size);
          if (r >= bestRank) { best = url; bestRank = r; }
        }
        return { name: u.name, avatarUrl: best };
      });
    };

    const topArtists = async (user) => {
      const res = await call('user.gettopartists', user, '&period=6month&limit=50');
      if (res.missing) return new Set();
      let list = res.data && res.data.topartists && res.data.topartists.artist;
      if (!list) return new Set();
      if (!Array.isArray(list)) list = [list];
      const names = new Set();
      for (const a of list) {
        const key = a && a.name && String(a.name).toLowerCase();
        if (key) names.add(key);
      }
      return names;
    };

    // Binary cosine over two name sets: shared / sqrt(|a| * |b|).
    const cosine = (a, b) => {
      if (!a.size || !b.size) return 0;
      let shared = 0;
      for (const k of a) if (b.has(k)) shared += 1;
      return shared / Math.sqrt(a.size * b.size);
    };

    // 1. Your friends. None means no candidates: a miss, not an error.
    const mine = await call('user.getfriends', username, '&limit=50');
    const myFriends = mine.missing ? [] : parseFriends(mine.data);
    if (!myFriends.length) return [];
    const myFriendNames = new Set(myFriends.map((f) => f.name.toLowerCase()));

    // 2. Friends of up to 20 of them, ranked by how many of your friends know them.
    const candidates = new Map();
    for (const friend of myFriends.slice(0, 20)) {
      const res = await call('user.getfriends', friend.name, '&limit=50');
      if (res.missing) continue;
      for (const fof of parseFriends(res.data)) {
        const key = fof.name.toLowerCase();
        if (key === selfName || myFriendNames.has(key) || exclude.has(key)) continue;
        const entry = candidates.get(key) || { name: fof.name, avatarUrl: null, count: 0 };
        entry.count += 1;
        if (!entry.avatarUrl) entry.avatarUrl = fof.avatarUrl;
        candidates.set(key, entry);
      }
    }
    const top = Array.from(candidates.values())
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, 40);
    if (!top.length) return [];

    // 3. Score the top 40 against your own taste.
    const mineArtists = await topArtists(username);
    if (!mineArtists.size) return [];
    const scored = [];
    for (const c of top) {
      const similarity = cosine(mineArtists, await topArtists(c.name));
      if (similarity >= 0.06) scored.push({ username: c.name, similarity, avatarUrl: c.avatarUrl });
    }
    return scored.sort((a, b) => b.similarity - a.similarity);
  }
};
