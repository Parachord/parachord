// Source of truth for plugins/soundcloud.axe v1.1.0.
// Imported from the .axe by `node scripts/build-axes.js --import`.
// Edit here, bump manifest.version in manifest.json, then run `node scripts/build-axes.js`.
// The functions materialize fully isolated (resolver-loader.js uses
// new Function) — no shared scope between them; helpers must be embedded per function.
module.exports = {
  search: async function (query, config) {
    if (!config.token) {
      console.log('SoundCloud: No token, skipping search');
      return [];
    }
    try {
      console.log('Searching SoundCloud for:', query);
      const response = await fetch(
        `https://api.soundcloud.com/tracks?q=${encodeURIComponent(query)}&limit=20`,
        { headers: { Authorization: `OAuth ${config.token}` } },
      );
      if (!response.ok) {
        console.error('SoundCloud search failed:', response.status);
        if (response.status === 401) {
          console.log('SoundCloud token expired or invalid');
        }
        return [];
      }
      const tracks = await response.json();
      if (!Array.isArray(tracks)) {
        console.log('No SoundCloud results found');
        return [];
      }
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
    } catch (error) {
      console.error('SoundCloud search error:', error);
      return [];
    }
  },
  resolve: async function (artist, track, album, config) {
    // Picks among the search's results the way pickTrackMatch
    // (sync-providers/track-match.js) does, rather than taking the first: the
    // top result for Ramones "Judy Is a Punk" was "Judy Is A Punk (1975 Demo)"
    // (#1306). Order: the exact track, then a match the platform's gate would
    // accept that is not another version, then any match the gate would
    // accept, then the top result, and the confidence gate has the last word.
    // The matching helpers are the Bandcamp plugin's (plugins-src/bandcamp,
    // resolve), copied because plugin functions run isolated; keep them the
    // same. This .axe also runs in the mobile JS runtime, so no property-escape
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
    var ARTIST_JOIN = /,|&| (?:and|x) | [(\[]?(?:feat\.?|ft\.?|featuring) /i;
    var TITLE_CREDIT = / *[(\[] *(?:feat|ft|featuring)[. ][^)\]]*[)\]] *$/i;
    var creditedNames = function (credit) {
      var parts = fold(credit).split(ARTIST_JOIN);
      var names = [];
      for (var p = 0; p < parts.length; p++) {
        var name = norm(parts[p]);
        if (name && names.indexOf(name) === -1) names.push(name);
      }
      return names;
    };
    var isSubset = function (a, b) {
      if (a.length === 0) return false;
      for (var n = 0; n < a.length; n++) {
        if (b.indexOf(a[n]) === -1) return false;
      }
      return true;
    };
    var artistsMatch = function (a, b) {
      if (contains(norm(a), norm(b))) return true;
      var namesA = creditedNames(a);
      var namesB = creditedNames(b);
      return isSubset(namesA, namesB) || isSubset(namesB, namesA);
    };
    var titlesMatch = function (a, b) {
      if (contains(norm(a), norm(b))) return true;
      var bare = norm(fold(a).replace(TITLE_CREDIT, ''));
      return !!bare && bare === norm(fold(b).replace(TITLE_CREDIT, ''));
    };
    var matches = function (r) {
      return !!r && !!r.artist && !!r.title && artistsMatch(r.artist, artist) && titlesMatch(r.title, track);
    };
    var requestedNames = creditedNames(artist);
    var sameCredit = function (credit) {
      var names = creditedNames(credit);
      return isSubset(names, requestedNames) && isSubset(requestedNames, names);
    };
    var stripFeat = function (s) {
      return (s || '')
        .toString()
        .replace(/\s*[([]\s*(feat\.?|ft\.?|featuring)\s[^)\]]*[)\]]/gi, '')
        .replace(/\s+(feat\.?|ft\.?|featuring)\s.*$/i, '');
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
    var isVariant = function (r) {
      return hasVariant(r.title, track) || hasVariant(r.artist, artist) || joinsSongs(r.title);
    };
    var targetArtist = norm(stripFeat(artist));
    var targetTitle = norm(stripFeat(track));
    var results = await this.search(((artist || '') + ' ' + (track || '')).trim(), config);
    if (!results || results.length === 0) return null;
    var i;
    if (targetArtist && targetTitle) {
      for (i = 0; i < results.length; i++) {
        var ra = norm(stripFeat(results[i].artist));
        var rt = norm(stripFeat(results[i].title));
        // Uploads are often titled "Artist - Title".
        if (rt.indexOf(targetArtist) === 0 && rt !== targetArtist) rt = rt.slice(targetArtist.length);
        if ((ra === targetArtist || sameCredit(results[i].artist)) && rt === targetTitle && !isVariant(results[i]))
          return results[i];
      }
    }
    for (i = 0; i < results.length; i++) {
      if (!isVariant(results[i]) && matches(results[i])) return results[i];
    }
    // Another version still plays when it is all that matches (pickTrackMatch's
    // last tier), and with no match at all the top result goes to the gate.
    for (i = 0; i < results.length; i++) {
      if (matches(results[i])) return results[i];
    }
    return results[0];
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
