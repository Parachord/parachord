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
  // Each kept person carries `topArtists`, their last month's top 3, for
  // the card; anyone who played nothing in the last month is dropped as
  // inactive (a failed check keeps them, with their 6-month top 3).
  // A failed request or error body throws (the page keeps what it has and
  // caches nothing empty); only "you have no friends" is a miss ([]).
  // Isolated (new Function): the pacer, fetch wrapper and cosine live inside.
  // The API key is only ever encoded into request URLs, never into a message.
  // config.apiKey is the app's choice (getLastfmApiKey, lib/lastfm-key.js),
  // and every request goes through the app's ws.audioscrobbler.com fetch
  // interceptor: a refused own key is swapped for the built-in one and the
  // request retried once; a refused built-in key throws (#1538).
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

    // A user's top artists for a period, as display names in rank order.
    const artistNames = async (user, period, limit) => {
      const res = await call('user.gettopartists', user, '&period=' + period + '&limit=' + limit);
      if (res.missing) return [];
      let list = res.data && res.data.topartists && res.data.topartists.artist;
      if (!list) return [];
      if (!Array.isArray(list)) list = [list];
      return list.map((a) => a && a.name && String(a.name)).filter(Boolean);
    };
    // The 6-month top 50, lowercased, for the score; `ranked` keeps the
    // display names for the card's fallback line.
    const topArtists = async (user) => {
      const ranked = await artistNames(user, '6month', 50);
      const names = new Set(ranked.map((n) => n.toLowerCase()));
      names.ranked = ranked;
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
      const theirs = await topArtists(c.name);
      const similarity = cosine(mineArtists, theirs);
      if (similarity >= 0.06) scored.push({ username: c.name, similarity, avatarUrl: c.avatarUrl, sixMonth: theirs.ranked });
    }
    scored.sort((a, b) => b.similarity - a.similarity);

    // 4. Each card lists the person's top few recent artists: the last
    // month's top 3 (one more request per person kept, usually a handful).
    // The same answer says who is active: nothing played in the last month
    // is an inactive listener, dropped. A failed request is not "inactive":
    // that person stays with their 6-month top 3, so an outage never empties
    // the row.
    const active = [];
    for (const user of scored) {
      let recent = null;
      try { recent = await artistNames(user.username, '1month', 3); } catch (e) { recent = null; }
      const sixMonth = user.sixMonth || [];
      delete user.sixMonth;
      if (recent && recent.length === 0) continue;
      const names = (recent && recent.length ? recent : sixMonth).slice(0, 3);
      if (names.length) user.topArtists = names;
      active.push(user);
    }
    return active;
  },

  // The similarArtists capability (#1539): artist.getsimilar, for the artist
  // page's Related Artists and Spinoff's top-up. It moved here from app.js
  // (getLastfmSimilarArtists) and spinoff-pool.js, so the app asks every
  // plug-in that can answer instead of Last.fm by name.
  // artist: { name, mbid?, limit? }. Answers [{ name, mbid?, match, url }],
  // match 0-100. Last.fm's error 6 ("not found") is a miss ([]); a failed
  // request, any other error body or a missing key THROWS, so an outage is
  // never read or cached as "no similar artists".
  // config.apiKey is the app's choice (lib/lastfm-key.js); the request goes
  // through the app's ws.audioscrobbler.com fetch interceptor (#1538). The key
  // is only ever encoded into the URL, never into a message.
  getSimilarArtists: async function (artist, config) {
    const name = artist && typeof artist.name === 'string' ? artist.name.trim() : '';
    if (!name) return [];
    const apiKey = config && config.apiKey;
    if (!apiKey) throw new Error('Last.fm similar artists: no API key yet');
    const limit = Math.max(1, Math.min(100, Number(artist.limit) || 20));
    const url = 'https://ws.audioscrobbler.com/2.0/?method=artist.getsimilar&artist=' + encodeURIComponent(name) +
      '&limit=' + limit + '&api_key=' + encodeURIComponent(apiKey) + '&format=json';
    const response = await fetch(url);
    if (!response.ok) throw new Error('Last.fm similar artists failed: ' + response.status);
    const data = await response.json();
    if (data && data.error !== undefined) {
      if (Number(data.error) === 6) return [];
      throw new Error('Last.fm similar artists failed: error ' + data.error);
    }
    const list = data && data.similarartists && data.similarartists.artist;
    const rows = Array.isArray(list) ? list : (list && typeof list === 'object' ? [list] : []);
    const out = [];
    for (const a of rows) {
      if (!a || typeof a.name !== 'string' || !a.name.trim()) continue;
      const pct = Math.round(parseFloat(a.match) * 100);
      out.push({
        name: a.name,
        mbid: a.mbid || undefined,
        match: Number.isFinite(pct) ? pct : 0,
        url: a.url || undefined
      });
    }
    return out;
  },

  // The similarTracks capability (#1539): track.getsimilar, for Spinoff.
  // track: { artist, title, limit? }. Answers [{ artist, title, mbid?, match }],
  // match 0-100. Same miss and failure rules as getSimilarArtists: error 6 is
  // [], anything else that goes wrong THROWS.
  getSimilarTracks: async function (track, config) {
    const artist = track && typeof track.artist === 'string' ? track.artist.trim() : '';
    const title = track && typeof track.title === 'string' ? track.title.trim() : '';
    if (!artist || !title) return [];
    const apiKey = config && config.apiKey;
    if (!apiKey) throw new Error('Last.fm similar tracks: no API key yet');
    const limit = Math.max(1, Math.min(100, Number(track.limit) || 20));
    const url = 'https://ws.audioscrobbler.com/2.0/?method=track.getsimilar&artist=' + encodeURIComponent(artist) +
      '&track=' + encodeURIComponent(title) + '&limit=' + limit +
      '&api_key=' + encodeURIComponent(apiKey) + '&format=json';
    const response = await fetch(url);
    if (!response.ok) throw new Error('Last.fm similar tracks failed: ' + response.status);
    const data = await response.json();
    if (data && data.error !== undefined) {
      if (Number(data.error) === 6) return [];
      throw new Error('Last.fm similar tracks failed: error ' + data.error);
    }
    const list = data && data.similartracks && data.similartracks.track;
    const rows = Array.isArray(list) ? list : (list && typeof list === 'object' ? [list] : []);
    const out = [];
    for (const t of rows) {
      if (!t || typeof t.name !== 'string' || !t.name.trim()) continue;
      const pct = Math.round(parseFloat(t.match) * 100);
      out.push({
        artist: (t.artist && t.artist.name) || 'Unknown Artist',
        title: t.name,
        mbid: t.mbid || undefined,
        match: Number.isFinite(pct) ? pct : 0
      });
    }
    return out;
  },

  // The charts capability (#1539 step 3): Last.fm's top tracks, worldwide
  // (chart.gettoptracks) or for a country (geo.gettoptracks), moved out of
  // app.js (loadLastfmCharts). query: { kind: 'tracks', country?, countryName?,
  // limit? }; countryName is the country's English name, which geo charts
  // take. Albums aren't charted (null). Answers [{ title, artist, albumArt,
  // url, listeners, listens, mbid }], most played first. Same failure rules as
  // the rest: an error body or a failed request THROWS.
  getCharts: async function (query, config) {
    if (!query || query.kind !== 'tracks') return null;
    const apiKey = config && config.apiKey;
    if (!apiKey) throw new Error('Last.fm chart: no API key yet');
    const limit = Math.max(1, Math.min(100, Number(query.limit) || 50));
    const countryName = query.country ? String(query.countryName || '').trim() : '';
    if (query.country && !countryName) return null;
    const url = 'https://ws.audioscrobbler.com/2.0/?' + (countryName
      ? 'method=geo.gettoptracks&country=' + encodeURIComponent(countryName)
      : 'method=chart.gettoptracks') +
      '&limit=' + limit + '&api_key=' + encodeURIComponent(apiKey) + '&format=json';
    const response = await fetch(url);
    if (!response.ok) throw new Error('Last.fm chart failed: ' + response.status);
    const data = await response.json();
    if (data && data.error !== undefined) throw new Error('Last.fm chart failed: error ' + data.error);
    const list = (data && ((data.tracks && data.tracks.track) || (data.toptracks && data.toptracks.track))) || [];
    const rows = Array.isArray(list) ? list : [list];
    const out = [];
    for (const t of rows) {
      if (!t || typeof t.name !== 'string' || !t.name.trim()) continue;
      const artist = (t.artist && t.artist.name) || (typeof t.artist === 'string' ? t.artist : '');
      const image = Array.isArray(t.image) ? t.image.find((img) => img && img.size === 'extralarge') : null;
      const art = image && image['#text'];
      const listeners = parseInt(t.listeners, 10);
      const listens = parseInt(t.playcount, 10);
      out.push({
        title: t.name,
        artist: artist || 'Unknown Artist',
        // Last.fm's grey star stands in for a missing cover: leave it out so
        // the app's album-art pipeline finds the real one.
        albumArt: art && art.indexOf('/2a96cbd8b46e442fc41c2b86b821562f.png') === -1 ? art : undefined,
        url: t.url || undefined,
        listeners: Number.isFinite(listeners) ? listeners : undefined,
        listens: Number.isFinite(listens) ? listens : undefined,
        mbid: t.mbid || undefined
      });
    }
    return out;
  },

  // The artistReleases capability (#1539 step 2): artist.gettopalbums, the
  // artist page's discography when MusicBrainz is slow or doesn't know the
  // artist, moved out of app.js (fetchArtistFromLastfm). artist: { name }.
  // Answers { artist: { name, mbid? }, releases: [{ id, title, date: null,
  // releaseType: 'album', albumArt }] }, most played first (Last.fm gives no
  // dates or types); a release's id is its MBID or its title as a slug (the
  // app prefixes it "lastfm-"). Error 6 or no albums is null; a failure
  // THROWS.
  getArtistReleases: async function (artist, config) {
    const name = artist && typeof artist.name === 'string' ? artist.name.trim() : '';
    if (!name) return null;
    const apiKey = config && config.apiKey;
    if (!apiKey) throw new Error('Last.fm artist releases: no API key yet');
    const limit = Math.max(1, Math.min(100, Number(artist.limit) || 100));
    const url = 'https://ws.audioscrobbler.com/2.0/?method=artist.gettopalbums&artist=' + encodeURIComponent(name) +
      '&limit=' + limit + '&api_key=' + encodeURIComponent(apiKey) + '&format=json';
    const response = await fetch(url);
    if (!response.ok) throw new Error('Last.fm artist releases failed: ' + response.status);
    const data = await response.json();
    if (data && data.error !== undefined) {
      if (Number(data.error) === 6) return null;
      throw new Error('Last.fm artist releases failed: error ' + data.error);
    }
    const list = data && data.topalbums && data.topalbums.album;
    const albums = Array.isArray(list) ? list : (list && typeof list === 'object' ? [list] : []);
    if (albums.length === 0) return null;
    const credited = (albums[0] && albums[0].artist) || {};
    const releases = [];
    for (const a of albums) {
      if (!a || typeof a.name !== 'string' || !a.name.trim() || a.name === '(null)') continue;
      const image = Array.isArray(a.image) ? a.image.find((img) => img && img.size === 'extralarge') : null;
      releases.push({
        id: a.mbid || a.name.toLowerCase().replace(/\s+/g, '-'),
        title: a.name,
        date: null,
        releaseType: 'album',
        albumArt: (image && image['#text']) || null
      });
    }
    return { artist: { name: credited.name || name, mbid: credited.mbid || undefined }, releases: releases };
  },

  // The artistTopTracks capability (#1539 step 2): artist.gettoptracks, moved
  // out of app.js (getArtistTopTracks). artist: { name, limit? }. Answers
  // [{ title, artist, duration (ms) or undefined, mbid?, listens }], most
  // played first. Same miss and failure rules as getSimilarArtists: error 6
  // is [], anything else that goes wrong THROWS.
  getArtistTopTracks: async function (artist, config) {
    const name = artist && typeof artist.name === 'string' ? artist.name.trim() : '';
    if (!name) return [];
    const apiKey = config && config.apiKey;
    if (!apiKey) throw new Error('Last.fm top tracks: no API key yet');
    const limit = Math.max(1, Math.min(100, Number(artist.limit) || 10));
    const url = 'https://ws.audioscrobbler.com/2.0/?method=artist.gettoptracks&artist=' + encodeURIComponent(name) +
      '&limit=' + limit + '&api_key=' + encodeURIComponent(apiKey) + '&format=json';
    const response = await fetch(url);
    if (!response.ok) throw new Error('Last.fm top tracks failed: ' + response.status);
    const data = await response.json();
    if (data && data.error !== undefined) {
      if (Number(data.error) === 6) return [];
      throw new Error('Last.fm top tracks failed: error ' + data.error);
    }
    const list = data && data.toptracks && data.toptracks.track;
    const rows = Array.isArray(list) ? list : (list && typeof list === 'object' ? [list] : []);
    const out = [];
    for (const t of rows) {
      if (!t || typeof t.name !== 'string' || !t.name.trim()) continue;
      const seconds = parseInt(t.duration, 10);
      const listens = parseInt(t.playcount, 10);
      out.push({
        title: t.name,
        artist: (t.artist && t.artist.name) || name,
        duration: seconds > 0 ? seconds * 1000 : undefined,
        mbid: t.mbid || undefined,
        listens: Number.isFinite(listens) ? listens : undefined
      });
    }
    return out.slice(0, limit);
  },

  // The biography capability (#1539 step 6): artist.getinfo, moved out of
  // app.js (getLastfmBio). artist: { name }. Answers { text, summary, url }:
  // the bio without its HTML, its "Read more on Last.fm" link and the licence
  // line Last.fm appends (the app's old check for that phrase dropped every
  // Last.fm bio). null when Last.fm doesn't know the artist (error 6) or its
  // bio is empty or a stub; anything else that goes wrong THROWS.
  getArtistBio: async function (artist, config) {
    const name = artist && typeof artist.name === 'string' ? artist.name.trim() : '';
    if (!name) return null;
    const apiKey = config && config.apiKey;
    if (!apiKey) throw new Error('Last.fm bio: no API key yet');
    const url = 'https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=' + encodeURIComponent(name) +
      '&autocorrect=1&api_key=' + encodeURIComponent(apiKey) + '&format=json';
    const response = await fetch(url);
    if (!response.ok) throw new Error('Last.fm bio failed: ' + response.status);
    const data = await response.json();
    if (data && data.error !== undefined) {
      if (Number(data.error) === 6) return null;
      throw new Error('Last.fm bio failed: error ' + data.error);
    }
    const info = data && data.artist;
    const bio = info && info.bio;
    if (!bio) return null;
    const clean = function (html) {
      return String(html || '')
        .replace(/<a\b[^>]*>\s*Read more on Last\.fm\s*<\/a>\.?/gi, '')
        .replace(/User-contributed text is available under the Creative Commons By-SA License;?\s*additional terms may apply\.?/gi, '')
        .replace(/<[^>]*>/g, '')
        .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    };
    const text = clean(bio.content) || clean(bio.summary);
    // An artist with no bio still gets a stub (a link, or a line).
    if (text.length < 50) return null;
    const summary = clean(bio.summary);
    return {
      text: text,
      summary: summary.length >= 50 ? summary : undefined,
      url: typeof info.url === 'string' && /^https:\/\//.test(info.url) ? info.url : undefined
    };
  }
};
