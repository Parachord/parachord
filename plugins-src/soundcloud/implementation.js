// Source of truth for plugins/soundcloud.axe v1.1.0.
// Imported from the .axe by `node scripts/build-axes.js --import`.
// Edit here, bump manifest.version in manifest.json, then run `node scripts/build-axes.js`.
// The functions materialize fully isolated (resolver-loader.js uses
// new Function) — no shared scope between them; helpers must be embedded per function.
module.exports = {
  search: async function (query, config) {
    // Signed out is a miss: an empty answer. A request that fails (offline,
    // a 401 or 429, a server error, a body that isn't a list) throws, so the
    // host can tell "SoundCloud has nothing" from "SoundCloud couldn't answer"
    // and ask again later instead of recording a miss (parachord-mobile#566).
    // The message carries the HTTP status ("SoundCloud search failed: 401"),
    // so a host can refresh the sign-in and retry on a 401.
    if (!config.token) {
      console.log('SoundCloud: No token, skipping search');
      return [];
    }
    console.log('Searching SoundCloud for:', query);
    const response = await fetch(
      `https://api.soundcloud.com/tracks?q=${encodeURIComponent(query)}&limit=20`,
      { headers: { Authorization: `OAuth ${config.token}` } },
    );
    if (!response.ok) {
      console.error('SoundCloud search failed:', response.status);
      throw new Error('SoundCloud search failed: ' + response.status);
    }
    const tracks = await response.json();
    if (!Array.isArray(tracks)) throw new Error('SoundCloud search returned no track list');
    const results = tracks.map((track) => ({
      id: `soundcloud-${track.id}`,
      title: track.title,
      artist: track.user?.username || 'Unknown Artist',
      album: track.label_name || undefined,
      duration: Math.floor((track.duration || 0) / 1000),
      sources: ['soundcloud'],
      soundcloudId: track.id,
      soundcloudUrl: track.permalink_url,
      albumArt: track.artwork_url?.replace('-large', '-t500x500') || track.user?.avatar_url,
      streamable: track.streamable && track.access !== 'blocked',
      // The widget plays `preview` and `blocked` tracks in full almost
      // never; rank them after other sources (compareCandidateSources).
      limitedPlayback: !!track.access && track.access !== 'playable',
      waveformUrl: track.waveform_url,
    }));
    console.log(`Found ${results.length} SoundCloud results`);
    return results;
  },
  resolve: async function (artist, track, album, config) {
    // The search result to play (#1306). SoundCloud is mostly fan uploads, so a
    // result counts as the requested artist's only when:
    // - its uploader IS the artist (names equal, a leading "The" aside), or
    // - its title is an "Artist - Title" upload naming the artist; the result
    //   then reports that artist and title, so the confidence gate scores it.
    // Containment isn't enough: "Ramones of the Day" contains "Ramones", and its
    // "ROTD-Ep100 Judy Is a Punk" is a 29-minute podcast. Among those, the
    // artist's own uploads first, then: the exact title, a title that isn't
    // another version, another version. With none, no SoundCloud source, never
    // the top result, which the gate's artist containment would accept.
    // Only tracks the widget will play: streamable, not preview or blocked.
    // Same rule as mobile's pickSoundCloudTrack (parachord-mobile#597); keep the
    // two the same. capabilities.resolvePicks has the host's play-time resolve
    // call this instead of choosing among search results itself.
    // This .axe also runs in the mobile JS runtime, so no property-escape
    // literal, which would stop the whole function parsing on an engine
    // without them.
    var MARKS = /[̀-ͯ]/g;
    var NON_ALNUM = /[^a-z0-9]/g;
    try {
      MARKS = new RegExp('\\p{M}', 'gu');
      NON_ALNUM = new RegExp('[^\\p{L}\\p{N}]', 'gu');
    } catch (e) {}
    var fold = function (s) {
      s = (s || '').toString().toLowerCase();
      if (typeof s.normalize === 'function') s = s.normalize('NFKD');
      return s.replace(MARKS, '');
    };
    var norm = function (s) {
      return fold(s).replace(NON_ALNUM, '');
    };
    var contains = function (a, b) {
      return !!a && !!b && (a.indexOf(b) !== -1 || b.indexOf(a) !== -1);
    };
    var TITLE_CREDIT = / *[(\[] *(?:feat|ft|featuring)[. ][^)\]]*[)\]] *$/i;
    // The title half of the platform's gate (validateResolvedTrack).
    var titlesMatch = function (a, b) {
      if (contains(norm(a), norm(b))) return true;
      var bare = norm(fold(a).replace(TITLE_CREDIT, ''));
      return !!bare && bare === norm(fold(b).replace(TITLE_CREDIT, ''));
    };
    var withoutLeadingThe = function (name) {
      var n = norm(name);
      return n.indexOf('the') === 0 ? n.slice(3) : n;
    };
    var VARIANT =
      /\b(live|medley|remix(es|ed)?|rmx|cover(s|ed)?|covering|tribute|karaoke|instrumental|acoustic|demo|unplugged|rework|bootleg|mashup|reprise|edit|jam track|sped up|slowed|in the style of)\b/gi;
    var hasVariant = function (s, target) {
      var words = (s || '').toString().match(VARIANT) || [];
      var t = (target || '').toString().toLowerCase();
      for (var w = 0; w < words.length; w++) {
        if (t.indexOf(words[w].toLowerCase()) === -1) return true;
      }
      return false;
    };
    var joinsSongs = function (title) {
      if ((track || '').toString().indexOf('/') !== -1) return false;
      var s = (title || '').toString().toLowerCase();
      var a = (artist || '').toString().toLowerCase();
      if (a.indexOf('/') !== -1) s = s.split(a).join(' ');
      s = s.replace(/\bw\/\s*/g, ' ');
      return /[^\s\d]\s*\/\s*[^\s\d]/.test(s);
    };
    var isVariant = function (title, uploader) {
      return hasVariant(title, track) || hasVariant(uploader, artist) || joinsSongs(title);
    };

    var results = await this.search(((artist || '') + ' ' + (track || '')).trim(), config);
    var playable = (results || []).filter(function (r) {
      return !!r && r.streamable && !r.limitedPlayback;
    });
    if (!artist || !track || !String(artist).trim() || !String(track).trim()) return playable[0] || null;

    var artistKey = withoutLeadingThe(artist);
    var own = [];
    var named = [];
    for (var i = 0; i < playable.length; i++) {
      var r = playable[i];
      if (!r.title) continue;
      var pick = null;
      if (withoutLeadingThe(r.artist) === artistKey) {
        pick = { result: r, title: r.title };
        if (titlesMatch(pick.title, track)) own.push(pick);
        continue;
      }
      var dash = r.title.indexOf(' - ');
      if (dash <= 0 || withoutLeadingThe(r.title.slice(0, dash)) !== artistKey) continue;
      pick = { result: r, artist: r.title.slice(0, dash).trim(), title: r.title.slice(dash + 3).trim() };
      if (titlesMatch(pick.title, track)) named.push(pick);
    }
    var candidates = own.concat(named);
    var target = norm(track);
    var found = null;
    var c;
    for (c = 0; c < candidates.length && !found; c++) {
      if (norm(candidates[c].title) === target && !isVariant(candidates[c].title, candidates[c].result.artist)) found = candidates[c];
    }
    for (c = 0; c < candidates.length && !found; c++) {
      if (!isVariant(candidates[c].title, candidates[c].result.artist)) found = candidates[c];
    }
    if (!found) found = candidates[0] || null;
    if (!found) return null;
    if (!found.artist) return found.result;
    var out = {};
    for (var k in found.result) out[k] = found.result[k];
    out.artist = found.artist;
    out.title = found.title;
    return out;
  },
  lookupUrl: async function (url, config) {
    // Without a sign-in the API can't be asked, but SoundCloud's public
    // oEmbed still describes a track link, and the widget plays it from the
    // link alone. oEmbed has no duration or access, so those stay unset and
    // the widget reports what it will play.
    if (!config.token) {
      try {
        const permalink = url.split(/[?#]/)[0];
        const response = await fetch(
          `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(permalink)}`,
        );
        if (!response.ok) return null;
        const embed = await response.json();
        // The embed's src names the track by its API URL (URL-encoded). A set
        // or a user page names /playlists/ or /users/ instead: not a track.
        const idMatch = String(embed?.html || '').match(/api\.soundcloud\.com(?:\/|%2F)tracks(?:\/|%2F)(\d+)/i);
        if (!idMatch) return null;
        const artist = embed.author_name || 'Unknown Artist';
        const byArtist = ` by ${artist}`;
        const title = embed.title && embed.title.endsWith(byArtist)
          ? embed.title.slice(0, -byArtist.length)
          : embed.title;
        if (!title) return null;
        return {
          id: `soundcloud-${idMatch[1]}`,
          title,
          artist,
          sources: ['soundcloud'],
          soundcloudId: Number(idMatch[1]),
          soundcloudUrl: permalink,
          albumArt: embed.thumbnail_url,
        };
      } catch (error) {
        console.error('SoundCloud oEmbed lookup error:', error);
        return null;
      }
    }
    try {
      const resolveResponse = await fetch(
        `https://api.soundcloud.com/resolve?url=${encodeURIComponent(url)}`,
        { headers: { Authorization: `OAuth ${config.token}` } },
      );
      if (!resolveResponse.ok) return null;
      const data = await resolveResponse.json();
      // /resolve answers with a redirect to the track, which fetch follows,
      // so the body is the track itself. It used to answer { location }
      // instead; keep following that in case it comes back.
      let track = data && data.kind === 'track' ? data : null;
      if (!track && data && data.location) {
        const trackResponse = await fetch(data.location.replace('soundcloud:tracks:', ''), {
          headers: { Authorization: `OAuth ${config.token}` },
        });
        if (!trackResponse.ok) return null;
        track = await trackResponse.json();
      }
      if (track) {
        return {
          id: `soundcloud-${track.id}`,
          title: track.title,
          artist: track.user?.username || 'Unknown Artist',
          album: track.label_name || undefined,
          duration: Math.floor((track.duration || 0) / 1000),
          sources: ['soundcloud'],
          soundcloudId: track.id,
          soundcloudUrl: track.permalink_url,
          albumArt: track.artwork_url?.replace('-large', '-t500x500'),
          streamable: track.streamable && track.access !== 'blocked',
          limitedPlayback: !!track.access && track.access !== 'playable',
        };
      }
      return null;
    } catch (error) {
      console.error('SoundCloud URL lookup error:', error);
      return null;
    }
  },
  lookupPlaylist: async function (url, config) {
    if (!config.token) {
      console.log('SoundCloud: No token, skipping playlist lookup');
      return null;
    }
    try {
      const resolveResponse = await fetch(
        `https://api.soundcloud.com/resolve?url=${encodeURIComponent(url)}`,
        { headers: { Authorization: `OAuth ${config.token}` } },
      );
      if (!resolveResponse.ok) {
        console.error('SoundCloud playlist resolve failed:', resolveResponse.status);
        return null;
      }
      const data = await resolveResponse.json();
      if (!data || !Array.isArray(data.tracks)) {
        console.log('SoundCloud resolve did not return a playlist');
        return null;
      }
      const tracks = data.tracks
        .map((t) => ({
          artist: t.user?.username || 'Unknown Artist',
          title: t.title,
          album: t.label_name || undefined,
          duration: Math.floor((t.duration || 0) / 1000),
          soundcloudId: t.id,
          soundcloudUrl: t.permalink_url,
          limitedPlayback: !!t.access && t.access !== 'playable',
        }))
        .filter((t) => t.title);
      if (!tracks.length) {
        console.log('SoundCloud playlist had no playable tracks');
        return null;
      }
      console.log(`SoundCloud playlist '${data.title}' -> ${tracks.length} tracks`);
      return {
        name: data.title || 'SoundCloud Playlist',
        creator: data.user?.username,
        tracks,
        albumArt: data.artwork_url?.replace('-large', '-t500x500') || data.user?.avatar_url,
      };
    } catch (error) {
      console.error('SoundCloud playlist lookup error:', error);
      return null;
    }
  },
  play: async function (track, config) {
    if (!track.soundcloudUrl) {
      console.error('No SoundCloud URL found');
      return false;
    }
    try {
      if (window.electron?.shell?.openExternal) {
        const result = await window.electron.shell.openExternal(track.soundcloudUrl);
        return result && result.success;
      } else {
        const newWindow = window.open(track.soundcloudUrl, '_blank');
        return !!newWindow;
      }
    } catch (error) {
      console.error('Failed to open SoundCloud link:', error);
      return false;
    }
  },
  init: async function (config) {
    console.log('SoundCloud resolver initialized');
  },
  cleanup: async function () {
    console.log('SoundCloud resolver cleanup');
  },
};
