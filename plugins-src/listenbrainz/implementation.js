// Source of truth for plugins/listenbrainz.axe v1.5.0.
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
    if (explorationItems.length) sections.push({ id: 'weekly-exploration', title: 'Weekly Exploration', category: 'personal', items: explorationItems });
    if (jamsItems.length) sections.push({ id: 'weekly-jams', title: 'Weekly Jams', category: 'personal', items: jamsItems });
    return { sections };
  },

  // capabilities.historyMixes (docs/architecture/plugins.md, "History
  // mixes"): the newest Daily Jams and the newest Weekly Jams, both made from
  // the user's own listening. The ids and urls are the ones getRecommendations
  // gives its weekly-jams playlist items (the bare playlist MBID,
  // https://listenbrainz.org/playlist/<mbid>/), so the Recommendations page
  // can drop a mix by id. getRecommendations still returns the Weekly Jams
  // for apps older than this capability. No username is a miss; a failed
  // request throws so an outage never replaces the cached mixes with [].
  getHistoryMixes: async function (config) {
    const username = config && config.username;
    if (!username) return { mixes: [] };
    // Inline retry helper (functions materialize isolated), as in
    // getRecommendations.
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
    const dateOf = (entry) => {
      const t = Date.parse((entry && entry.playlist && entry.playlist.date) || '');
      return Number.isFinite(t) ? t : 0;
    };
    // Same classification as getRecommendations: the algorithm source_patch,
    // then the title.
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
    const response = await fetchListenBrainz(`https://api.listenbrainz.org/1/user/${encodeURIComponent(username)}/playlists/recommendations`);
    if (!response.ok) {
      throw new Error(`Failed to fetch ListenBrainz history mixes: ${response.status}`);
    }
    const data = await response.json();
    const playlists = (data && data.playlists) || [];
    const NAMES = { 'daily-jams': 'Daily Jams', 'weekly-jams': 'Weekly Jams' };
    // The card's subhead: the dated part of ListenBrainz's title ("Weekly Jams
    // for x, week of 2026-09-14 Mon" -> "Week of Sep 14, 2026"; "Daily Jams
    // for x, 2026-11-11" -> "Nov 11, 2026"), since the card's title already
    // names the mix. A title of another shape stays as it is.
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const datedPart = (title) => {
      const m = /,\s*(week of\s+)?(\d{4})-(\d{2})-(\d{2})/i.exec(title);
      const month = m && MONTHS[Number(m[3]) - 1];
      if (!month) return title;
      const date = `${month} ${Number(m[4])}, ${m[2]}`;
      return m[1] ? `Week of ${date}` : date;
    };
    const mixes = [];
    ['daily-jams', 'weekly-jams'].forEach((type) => {
      const newest = playlists
        .filter(entry => typeOf(entry) === type)
        .sort((a, b) => dateOf(b) - dateOf(a))[0];
      const id = newest && String((newest.playlist && newest.playlist.identifier) || '').split('/').pop();
      if (!id) return;
      mixes.push({
        type: 'playlist',
        id,
        name: NAMES[type],
        description: datedPart(String(newest.playlist.title || '')) || undefined,
        url: `https://listenbrainz.org/playlist/${id}/`
      });
    });
    return { mixes };
  },

  // The urlLookup capability for a ListenBrainz playlist page
  // (https://listenbrainz.org/playlist/<mbid>, with or without www. or a
  // trailing slash): what Home's history-mix cards and any pasted playlist
  // link go through (resolver-loader.js lookupPlaylist). Fetches the JSPF
  // from /1/playlist/<mbid> and maps its tracks. A page that isn't a playlist
  // URL is a miss (null); a failed request throws so the caller can say so
  // instead of treating an outage as an empty playlist.
  lookupPlaylist: async function (url, config) {
    const match = String(url || '').match(/listenbrainz\.org\/playlist\/([^/?#]+)/i);
    if (!match) return null;
    const mbid = match[1];
    const headers = config && config.userToken ? { Authorization: 'Token ' + config.userToken } : {};
    // Inline retry helper (functions materialize isolated), as in
    // getRecommendations.
    const maxRetries = 3;
    let response = null;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        response = await fetch(`https://api.listenbrainz.org/1/playlist/${encodeURIComponent(mbid)}`, { headers });
        if (response.ok) break;
        if (response.status === 429 || response.status === 503) {
          if (attempt < maxRetries - 1) {
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1500));
          }
          continue;
        }
        break;
      } catch (networkError) {
        if (attempt < maxRetries - 1) {
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1500));
        } else {
          throw networkError;
        }
      }
    }
    if (!response || !response.ok) {
      throw new Error(`Failed to fetch the ListenBrainz playlist: ${response ? response.status : 'no response'}`);
    }
    const data = await response.json();
    const playlist = (data && data.playlist) || {};
    const tracks = [];
    for (const track of (playlist.track || [])) {
      const title = track && track.title;
      if (!title) continue;
      const mbid = (track.identifier && track.identifier[0] || '').split('/').pop() || null;
      const out = {
        artist: (track && track.creator) || 'Unknown Artist',
        title: title,
        duration: track.duration ? Math.floor(track.duration / 1000) : null
      };
      // The release ListenBrainz matched rides in the JSPF track extension
      // (generated playlists carry no plain album); with it the playlist
      // mosaic finds album covers instead of artist photos.
      const ext = (track.extension && track.extension['https://musicbrainz.org/doc/jspf#track']) || {};
      const meta = ext.additional_metadata || {};
      const album = [track.album, ext.release_name, meta.release_name]
        .find(v => typeof v === 'string' && v.trim());
      if (album) out.album = album.trim();
      if (mbid) out.mbid = mbid;
      tracks.push(out);
    }
    return {
      name: playlist.title || 'ListenBrainz Playlist',
      creator: playlist.creator || undefined,
      tracks: tracks
    };
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
    const users = rows
      .filter(r => r && r.user_name)
      .map(r => ({ username: r.user_name, similarity: Number(r.similarity) || 0 }))
      .sort((a, b) => b.similarity - a.similarity);
    // Each card lists the person's top few recent artists: this month's top
    // 3, or last month's when this month has no stats yet (a 204). The same
    // answer says who is active: no stats this month or last (204 both
    // times) is an inactive listener, dropped. Only the 20 most similar are
    // checked, one at a time, each request asked once with no retry (a
    // backoff per person would stall the row); people past 20 are dropped
    // unchecked. A failed request is not "inactive": that person stays,
    // without the line, so an outage never empties the row.
    const activityFor = async (user) => {
      let failed = false;
      for (const range of ['this_month', 'month']) {
        try {
          const res = await fetch(`https://api.listenbrainz.org/1/stats/user/${encodeURIComponent(user)}/artists?range=${range}&count=3`);
          if (res.status === 204) continue;
          if (!res.ok) { failed = true; continue; }
          const body = await res.json();
          const names = ((body && body.payload && body.payload.artists) || [])
            .map(a => a && a.artist_name)
            .filter(n => typeof n === 'string' && n.trim())
            .slice(0, 3);
          if (names.length) return { active: true, names };
        } catch (e) {
          failed = true;
        }
      }
      return failed ? { active: true, names: [] } : { active: false, names: [] };
    };
    const active = [];
    for (const user of users.slice(0, 20)) {
      const activity = await activityFor(user.username);
      if (!activity.active) continue;
      if (activity.names.length) user.topArtists = activity.names;
      active.push(user);
    }
    return active;
  },

  // The similarArtists capability (#1539): ListenBrainz's similar-artists data
  // (the labs API, by MusicBrainz artist id), for the artist page's Related
  // Artists and Spinoff's top-up. It moved here from app.js
  // (getListenBrainzSimilarArtists). No account needed.
  // artist: { name, mbid?, limit? }. Without an MBID there is nothing to ask:
  // a miss ([]), not a failure. Answers [{ name, mbid, match }], most similar
  // first. `score` is a raw count (11156 for Radiohead's top match on
  // 2026-11-19), so match is each score against the top one, 0-100; without
  // scores, a falling rank. The answer doesn't start with the artist itself
  // (app.js used to drop its first row, which was the closest match); a row
  // for it is dropped by id. A failed request THROWS, so an outage never
  // reads as "no similar artists".
  getSimilarArtists: async function (artist, _config) {
    const mbid = artist && typeof artist.mbid === 'string' ? artist.mbid.trim() : '';
    if (!mbid) return [];
    const limit = Math.max(1, Math.min(100, Number(artist.limit) || 20));
    const response = await fetch('https://labs.api.listenbrainz.org/similar-artists/json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{
        artist_mbids: [mbid],
        algorithm: 'session_based_days_7500_session_300_contribution_5_threshold_10_limit_100_filter_True_skip_30'
      }])
    });
    if (!response.ok) throw new Error('ListenBrainz similar artists failed: ' + response.status);
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error('ListenBrainz similar artists: unexpected answer');
    const rows = data.filter((a) => a && (a.artist_mbid || '').toLowerCase() !== mbid.toLowerCase()
      && typeof (a.name || a.artist_name) === 'string' && (a.name || a.artist_name).trim());
    const top = rows.reduce((m, a) => {
      const n = Number(a.score);
      return Number.isFinite(n) && n > m ? n : m;
    }, 0);
    return rows.slice(0, limit).map((a, index) => {
      const n = Number(a.score);
      const match = top > 0 && Number.isFinite(n) && n > 0
        ? Math.max(1, Math.round((n / top) * 100))
        : Math.max(95 - (index * 4), 20);
      return { name: a.name || a.artist_name, mbid: a.artist_mbid || undefined, match: match };
    });
  },

  // The listeningHistory capability (#1539 step 4): a ListenBrainz user's
  // own stats (/1/stats/user/<user>/{recordings,releases,artists}), moved out
  // of app.js. query: { user?, kind: 'tracks' | 'albums' | 'artists', period,
  // limit? }; user defaults to the signed-in username (config.username);
  // period is 'week' | 'month' | 'quarter' | 'half_year' | 'year' | 'all'
  // (ListenBrainz's week, month, quarter, half_yearly, year and all_time: the
  // last full week, month and so on). The user's token goes along when there
  // is one. Answers tracks [{ title, artist, album?, plays, mbid?, albumArt? }],
  // albums [{ title, artist, plays, mbid?, albumArt? }] or artists [{ name,
  // plays, mbid? }], most played first. A cover is ListenBrainz's own match,
  // only when the archive has a front image (caa_id; lib/listenbrainz-cover.js).
  // No user is null; 204 (not calculated yet) is []; a failure THROWS.
  getTopItems: async function (query, config) {
    var user = String((query && query.user) || (config && config.username) || '').trim();
    if (!user) return null;
    var kind = query && query.kind;
    var entity = { tracks: 'recordings', albums: 'releases', artists: 'artists' }[kind];
    if (!entity) return null;
    var range = { week: 'week', month: 'month', quarter: 'quarter', half_year: 'half_yearly', year: 'year', all: 'all_time' }[query.period] || 'all_time';
    var limit = Math.max(1, Math.min(100, Number(query.limit) || 50));
    var headers = config && config.userToken ? { Authorization: 'Token ' + config.userToken } : {};
    var response = await fetch('https://api.listenbrainz.org/1/stats/user/' + encodeURIComponent(user) + '/' + entity +
      '?range=' + range + '&count=' + limit, { headers: headers });
    if (response.status === 204) return [];
    if (!response.ok) throw new Error('ListenBrainz history failed: ' + response.status);
    var data = await response.json();
    var list = data && data.payload && data.payload[entity];
    if (!Array.isArray(list)) throw new Error('ListenBrainz history: unexpected answer');
    var cover = function (r) {
      return r.caa_id && r.caa_release_mbid ? 'https://coverartarchive.org/release/' + r.caa_release_mbid + '/front-250' : undefined;
    };
    var out = [];
    list.forEach(function (r) {
      if (!r) return;
      var plays = Number(r.listen_count) || 0;
      if (kind === 'artists') {
        if (r.artist_name) out.push({ name: r.artist_name, plays: plays, mbid: r.artist_mbid || undefined });
      } else if (kind === 'tracks') {
        if (r.track_name) out.push({ title: r.track_name, artist: r.artist_name || 'Unknown Artist', album: r.release_name || undefined, plays: plays, mbid: r.recording_mbid || undefined, albumArt: cover(r) });
      } else if (r.release_name) {
        out.push({ title: r.release_name, artist: r.artist_name || 'Unknown Artist', plays: plays, mbid: r.release_mbid || undefined, albumArt: cover(r) });
      }
    });
    return out;
  },

  // listeningHistory: a user's recent listens (/1/user/<user>/listens),
  // newest first. query: { user?, limit? }. Answers [{ title, artist,
  // album?, albumArt?, playedAt (ms) or null while playing, nowPlaying,
  // mbid?, msid? }]. Same rules as getTopItems.
  getRecentListens: async function (query, config) {
    var user = String((query && query.user) || (config && config.username) || '').trim();
    if (!user) return null;
    var limit = Math.max(1, Math.min(100, Number(query && query.limit) || 50));
    var headers = config && config.userToken ? { Authorization: 'Token ' + config.userToken } : {};
    var response = await fetch('https://api.listenbrainz.org/1/user/' + encodeURIComponent(user) + '/listens?count=' + limit, { headers: headers });
    if (!response.ok) throw new Error('ListenBrainz recent listens failed: ' + response.status);
    var data = await response.json();
    var listens = data && data.payload && data.payload.listens;
    if (!Array.isArray(listens)) throw new Error('ListenBrainz recent listens: unexpected answer');
    return listens.filter(function (l) {
      return l && l.track_metadata && l.track_metadata.track_name;
    }).map(function (l) {
      var meta = l.track_metadata;
      var map = meta.mbid_mapping || {};
      var info = meta.additional_info || {};
      return {
        title: meta.track_name,
        artist: meta.artist_name || 'Unknown Artist',
        album: meta.release_name || undefined,
        albumArt: map.caa_id && map.caa_release_mbid ? 'https://coverartarchive.org/release/' + map.caa_release_mbid + '/front-250' : undefined,
        playedAt: l.listened_at ? l.listened_at * 1000 : null,
        nowPlaying: !!l.playing_now,
        mbid: info.recording_mbid || map.recording_mbid || undefined,
        msid: l.recording_msid || undefined
      };
    });
  },

  // The charts capability (#1539 step 3): what everyone on ListenBrainz
  // played this week, from its sitewide statistics (/1/stats/sitewide/
  // recordings and /release-groups). query: { kind: 'tracks' | 'albums',
  // country?, limit? }. Worldwide only, so a country is null. No account is
  // needed, but the user's token goes along when there is one: ListenBrainz
  // turns some anonymous requests away (a "verifying your browser" page,
  // 2026-11). Each request gives up after 10 s, so the app can move on to
  // another chart. Answers tracks [{ title, artist, album, mbid, listens }]
  // or albums [{ title, artist, mbid (the release group's), listens }]; 204
  // (not calculated yet) is []; a failure or an answer that isn't the
  // statistics THROWS.
  getCharts: async function (query, config) {
    var kind = query && query.kind;
    if (kind !== 'tracks' && kind !== 'albums') return null;
    if (query.country) return null;
    var limit = Math.max(1, Math.min(100, Number(query.limit) || 50));
    var entity = kind === 'tracks' ? 'recordings' : 'release-groups';
    var headers = config && config.userToken ? { Authorization: 'Token ' + config.userToken } : {};
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 10000);
    var data;
    try {
      var response = await fetch('https://api.listenbrainz.org/1/stats/sitewide/' + entity + '?range=week&count=' + limit,
        { headers: headers, signal: controller.signal });
      if (response.status === 204) return [];
      if (!response.ok) throw new Error('ListenBrainz chart failed: ' + response.status);
      data = await response.json();
    } catch (error) {
      if (error && error.name === 'AbortError') throw new Error('ListenBrainz chart: no answer in 10 s');
      throw error;
    } finally {
      clearTimeout(timer);
    }
    var payload = data && data.payload;
    var list = payload && (kind === 'tracks' ? payload.recordings : payload.release_groups);
    if (!Array.isArray(list)) throw new Error('ListenBrainz chart: unexpected answer');
    return list.filter(function (r) {
      return r && (kind === 'tracks' ? r.track_name : r.release_group_name) && r.artist_name;
    }).slice(0, limit).map(function (r) {
      var listens = Number(r.listen_count);
      return kind === 'tracks'
        ? { title: r.track_name, artist: r.artist_name, album: r.release_name || undefined, mbid: r.recording_mbid || undefined, listens: Number.isFinite(listens) ? listens : undefined }
        : { title: r.release_group_name, artist: r.artist_name, mbid: r.release_group_mbid || undefined, listens: Number.isFinite(listens) ? listens : undefined };
    });
  },

  // The artistTopTracks capability (#1539 step 2): the artist's recordings by
  // listen count, from /1/popularity/top-recordings-for-artist/<mbid>.
  // artist: { name, mbid?, limit? }. Without an MBID there is nothing to ask:
  // a miss ([]). ListenBrainz answers this endpoint only for a signed-in user
  // (it refuses anonymous requests with a 401 since 2026-11, citing scrapers),
  // so without the user's token this THROWS, as does a failed request: the
  // app then plays another plug-in's list rather than "no top tracks".
  // ListenBrainz splits a song's plays across duplicate recordings, so a
  // title is kept once (its most played recording). Answers [{ title, artist,
  // album, duration (ms), mbid, listens }], most played first.
  getArtistTopTracks: async function (artist, config) {
    const mbid = artist && typeof artist.mbid === 'string' ? artist.mbid.trim() : '';
    if (!mbid) return [];
    const token = config && config.userToken;
    if (!token) throw new Error('ListenBrainz top tracks need a signed-in account');
    const limit = Math.max(1, Math.min(100, Number(artist.limit) || 10));
    const response = await fetch('https://api.listenbrainz.org/1/popularity/top-recordings-for-artist/' + encodeURIComponent(mbid), {
      headers: { Authorization: 'Token ' + token }
    });
    if (!response.ok) throw new Error('ListenBrainz top tracks failed: ' + response.status);
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error('ListenBrainz top tracks: unexpected answer');
    const seen = new Set();
    const out = [];
    for (const r of data) {
      const title = r && typeof r.recording_name === 'string' ? r.recording_name.trim() : '';
      if (!title) continue;
      const key = title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const length = Number(r.length);
      const listens = Number(r.total_listen_count);
      out.push({
        title: r.recording_name,
        artist: r.artist_name || artist.name,
        album: r.release_name || undefined,
        duration: length > 0 ? length : undefined,
        mbid: r.recording_mbid || undefined,
        listens: Number.isFinite(listens) ? listens : undefined
      });
      if (out.length >= limit) break;
    }
    return out;
  }
};
