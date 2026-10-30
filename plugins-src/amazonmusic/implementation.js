// Source of truth for plugins/amazonmusic.axe v1.6.2.
// Imported from the .axe by `node scripts/build-axes.js --import`.
// Edit here, bump manifest.version in manifest.json, then run `node scripts/build-axes.js`.
// The functions materialize fully isolated (resolver-loader.js uses
// new Function) — no shared scope between them; helpers must be embedded per function.
module.exports = {
  search: async function (query, config) {
    try {
      if (!window.electron || !window.electron.amazonMusic) {
        console.warn('Amazon Music: bridge not available');
        return [];
      }
      var payload = query;
      if (typeof query === 'string') {
        if (!query.trim() || query.trim().length < 2) return [];
        payload = query.trim();
      } else if (
        !query ||
        (!(query.title && String(query.title).trim()) &&
          !(query.artist && String(query.artist).trim()))
      ) {
        return [];
      }
      const result = await window.electron.amazonMusic.searchTracks(payload);
      console.log(
        '[Amazon] resolver search',
        typeof payload === 'string' ? payload : payload,
        result && result.success,
        result && result.reason,
        result && result.tracks && result.tracks.length,
      );
      if (!result || !result.success) {
        var reason = result && result.reason;
        if (
          reason === 'not-ready' ||
          reason === 'not-signed-in' ||
          reason === 'no-cdm' ||
          reason === 'load-failed'
        ) {
          var err = new Error('Amazon Music not ready');
          err.notReady = true;
          err.code = reason;
          throw err;
        }
        return [];
      }
      var tracks = result.tracks || [];
      return tracks.map(function (t) {
        return {
          id: 'amazonmusic-' + t.asin,
          title: t.title,
          artist: t.artist,
          album: t.album,
          duration: t.duration || 0,
          sources: ['amazonmusic'],
          amazonAsin: t.asin,
          amazonUniqueId: t.uniqueId,
          genre: t.genre || null,
          explicit: !!t.explicit,
          // The gql search response carries the track's own cover art (the
          // DOM scrape never had it) — getAlbumArtFromResolvers can hit it.
          albumArt: t.albumArt || null,
        };
      });
    } catch (error) {
      if (error && error.notReady) throw error;
      console.error('Amazon Music search error:', error);
      return [];
    }
  },
  resolve: async function (artist, track, album, config) {
    var norm = function (s) {
      s = (s || '').toString().toLowerCase();
      try {
        s = s.normalize('NFKD');
      } catch (e) {}
      return s.replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]/gu, '');
    };
    var contains = function (a, b) {
      return !!a && !!b && (a.indexOf(b) !== -1 || b.indexOf(a) !== -1);
    };
    var targetArtist = norm(artist);
    var targetTitle = norm(track);
    console.log('[Amazon] resolver resolve', artist, track, 'norm', targetArtist, targetTitle);
    var results = await this.search({ title: track, artist: artist }, config);
    console.log(
      '[Amazon] resolver hits',
      results.length,
      results.slice(0, 3).map(function (r) {
        return (r.artist || '') + ' — ' + (r.title || '');
      }),
    );
    if (results.length === 0) return null;
    // The first containment hit used to win, so a live cut, remix or karaoke
    // version ranked above the original was what played and scrobbled (the
    // same flaw the Bandcamp resolver had). Pass 1: an exact artist + title
    // match, ignoring feat. credits. Pass 2: a containment match that is not
    // another version (a version word the requested title lacks; the list
    // matches src/renderer/lib/track-variants.js). Pass 3: any containment
    // match, since a "Remastered" or live track by the right artist is still
    // better than nothing on a service whose catalog is the artist's own.
    var stripFeat = function (s) {
      return (s || '')
        .toString()
        .replace(/\s*[([]\s*(feat\.?|ft\.?|featuring)\s[^)\]]*[)\]]/gi, '')
        .replace(/\s+(feat\.?|ft\.?|featuring)\s.*$/i, '');
    };
    var VARIANT =
      /\b(live|remix(es|ed)?|rmx|cover(s|ed)?|covering|tribute|karaoke|instrumental|acoustic|demo|unplugged|rework|bootleg|mashup|reprise|edit|jam track|sped up|slowed|in the style of)\b/gi;
    var isVariant = function (r) {
      var words = ((r.title || '') + ' ' + (r.artist || '')).match(VARIANT) || [];
      var asked = ((track || '') + ' ' + (artist || '')).toLowerCase();
      for (var w = 0; w < words.length; w++) {
        if (asked.indexOf(words[w].toLowerCase()) === -1) return true;
      }
      return false;
    };
    var exactArtist = norm(stripFeat(artist));
    var exactTitle = norm(stripFeat(track));
    var containing = results.filter(function (r) {
      return contains(norm(r.artist), targetArtist) && contains(norm(r.title), targetTitle);
    });
    if (exactArtist && exactTitle) {
      for (var i = 0; i < containing.length; i++) {
        if (
          norm(stripFeat(containing[i].artist)) === exactArtist &&
          norm(stripFeat(containing[i].title)) === exactTitle &&
          !isVariant(containing[i])
        )
          return containing[i];
      }
    }
    for (var j = 0; j < containing.length; j++) {
      if (!isVariant(containing[j])) return containing[j];
    }
    return containing[0] || null;
  },
  play: async function (track, config) {
    try {
      if (!window.electron || !window.electron.amazonMusic) {
        console.error('Amazon Music: bridge not available');
        return false;
      }
      var asin = track.amazonAsin || track.asin;
      if (!asin) {
        console.error('Amazon Music: no ASIN on track');
        return false;
      }
      var attempt = function () {
        return window.electron.amazonMusic.playTrack({
          asin: asin,
          title: track.title,
          artist: track.artist,
        });
      };
      var result = await attempt();
      if (result && result.success) return true;
      var reason = result && result.reason;
      if (reason === 'not-ready' || reason === 'not-signed-in' || reason === 'no-cdm') {
        console.log('Amazon Music: not connected (' + reason + '), asking you to sign in...');
        var managed = false;
        if (typeof window.__parachordManageAmazonMusic === 'function') {
          managed = await window.__parachordManageAmazonMusic({ explicit: true, reason: reason });
        }
        if (!managed) return false;
        result = await attempt();
        return !!(result && result.success);
      }
      console.error('Amazon Music play failed:', result && result.error);
      return false;
    } catch (error) {
      console.error('Amazon Music play error:', error);
      return false;
    }
  },
  init: async function (config) {
    console.log('Amazon Music resolver initialized');
    return true;
  },
  cleanup: async function () {
    console.log('Amazon Music resolver cleanup');
    try {
      if (window.electron && window.electron.amazonMusic && window.electron.amazonMusic.polling) {
        window.electron.amazonMusic.polling.stop();
      }
    } catch (e) {}
  },
  // capabilities.albumSearch (docs/architecture/plugins.md, "searchAlbums"):
  // the album-page catalog fallback. searchAlbums finds an album by
  // artist+title or free text over the albums tab of Amazon's spec search;
  // lookupAlbum loads what searchAlbums returned (the host calls it on this
  // plugin) by replaying the album page's own AlbumDetailPage gql request.
  // Both ride the same IPC chain as the track search / playlist import.
  searchAlbums: async function (query, config) {
    try {
      if (!window.electron || !window.electron.amazonMusic) {
        console.warn('Amazon Music: bridge not available');
        return [];
      }
      var payload = query;
      if (typeof query === 'string') {
        if (!query.trim() || query.trim().length < 2) return [];
        payload = query.trim();
      } else if (
        !query ||
        (!(query.title && String(query.title).trim()) &&
          !(query.artist && String(query.artist).trim()))
      ) {
        return [];
      }
      const result = await window.electron.amazonMusic.searchAlbums(payload);
      console.log(
        '[Amazon] resolver album search',
        payload,
        result && result.success,
        result && result.reason,
        result && result.albums && result.albums.length,
      );
      if (!result || !result.success) {
        var reason = result && result.reason;
        if (
          reason === 'not-ready' ||
          reason === 'not-signed-in' ||
          reason === 'no-cdm' ||
          reason === 'load-failed'
        ) {
          var err = new Error('Amazon Music not ready');
          err.notReady = true;
          err.code = reason;
          throw err;
        }
        return [];
      }
      return (result.albums || []).map(function (a) {
        return {
          id: 'amazonmusic-album-' + a.asin,
          name: a.name,
          artist: a.artist || null,
          albumArt: a.albumArt || null,
          // The album search spec carries no releaseDate or trackCount; the
          // plugin contract allows both to be null.
          releaseDate: null,
          trackCount: null,
          url: a.url,
          explicit: !!a.explicit,
        };
      });
    } catch (error) {
      if (error && error.notReady) throw error;
      console.error('Amazon Music album search error:', error);
      return [];
    }
  },
  // capabilities.artistImage (docs/architecture/plugins.md,
  // "searchArtistImage"): a photo of an artist by name, from the artists tab
  // of the same spec search the track and album searches use
  // (docs/architecture/amazon-music.md). The bridge returns the photo URL or
  // null: not signed in is null WITHOUT a request — the artist-image chain
  // just asks the next source (Deezer needs no account) — a miss is null,
  // and the exact-name check happens main-side, so a wrong artist's photo
  // can never reach the persisted image cache. A host whose bridge predates
  // this capability is a quiet no-op.
  searchArtistImage: async function (artistName, config) {
    try {
      if (
        !window.electron ||
        !window.electron.amazonMusic ||
        typeof window.electron.amazonMusic.searchArtistImage !== 'function'
      ) {
        return null;
      }
      var name = (artistName || '').trim();
      if (name.length < 2) return null;
      var result = await window.electron.amazonMusic.searchArtistImage(name);
      console.log(
        '[Amazon] resolver artist image',
        name,
        result && result.success ? 'ok' : result && result.reason,
        result && result.imageUrl ? 'hit' : 'miss',
      );
      if (!result || !result.success || !result.imageUrl) return null;
      var url = result.imageUrl;
      // The bridge only returns credential-free https CDN URLs, but this URL
      // is persisted in the image cache — check before trusting.
      if (typeof url !== 'string' || !/^https:\/\//i.test(url) || url.indexOf('?') !== -1) return null;
      return url;
    } catch (error) {
      console.error('Amazon Music artist image error:', error);
      return null;
    }
  },
  lookupAlbum: async function (url, config) {
    var mapAlbum = function (a) {
      return {
        id: 'amazonmusic-album-' + a.asin,
        name: a.name,
        artist: a.artist || null,
        albumArt: a.albumArt || null,
        releaseDate: a.releaseDate || null,
        // The bridge reports the album's own trackCount; keep it so a
        // server-truncated load is visible instead of silently complete.
        trackCount: a.trackCount || a.tracks.length,
        url: a.url || url,
        tracks: a.tracks.map(function (t) {
          return {
            id: 'amazonmusic-' + t.asin,
            title: t.title,
            artist: t.artist || a.artist || '',
            album: a.name,
            duration: t.duration || 0,
            sources: ['amazonmusic'],
            amazonAsin: t.asin,
            albumAsin: a.asin,
            trackNumber: typeof t.trackNumber === 'number' ? t.trackNumber : null,
            discNumber: typeof t.discNumber === 'number' ? t.discNumber : null,
            explicit: !!t.explicit,
            albumArt: a.albumArt || null,
          };
        }),
      };
    };
    var loaded = function (result) {
      return !!(
        result &&
        result.success &&
        result.album &&
        result.album.tracks &&
        result.album.tracks.length > 0
      );
    };
    var result = null;
    try {
      if (!window.electron || !window.electron.amazonMusic) {
        console.warn('Amazon Music: bridge not available');
        return null;
      }
      result = await window.electron.amazonMusic.lookupAlbum(url);
      console.log(
        '[Amazon] resolver album lookup',
        url,
        result && result.success,
        result && result.reason,
        result && result.album && result.album.tracks && result.album.tracks.length,
      );
      if (loaded(result)) return mapAlbum(result.album);
      // Only a sign-in problem is fixed by sign-in — the same rule the
      // playlist import follows.
      if (result && result.reason === 'not-signed-in') {
        console.log('Amazon Music: not signed in, asking you to sign in...');
        var managed = false;
        if (typeof window.__parachordManageAmazonMusic === 'function') {
          managed = await window.__parachordManageAmazonMusic({
            explicit: true,
            reason: 'not-signed-in',
          });
        }
        if (managed) {
          result = await window.electron.amazonMusic.lookupAlbum(url);
          if (loaded(result)) return mapAlbum(result.album);
        }
        var err = new Error(
          'Amazon Music is not signed in - sign in from Settings to load albums',
        );
        err.notReady = true;
        err.code = 'not-signed-in';
        throw err;
      }
    } catch (error) {
      if (error && error.notReady) throw error;
      console.error('Amazon Music album lookup error:', error);
      return null;
    }
    // Outside the try so the catch does not swallow these, the same pattern
    // as lookupPlaylist: transient/wiring failures (a stalled load, a hornet
    // rename) must not be reported as a missing album.
    var reason = result && result.reason;
    if (
      reason === 'load-failed' ||
      reason === 'no-cdm' ||
      reason === 'not-ready' ||
      reason === 'lookup-failed'
    ) {
      var transientErr = new Error(
        'Amazon Music is not reachable right now - check your connection and try again',
      );
      transientErr.notReady = true;
      transientErr.code = reason;
      throw transientErr;
    }
    // success with album: null is the legitimate miss (deleted / other
    // region); so is any other outcome — the catalog fallback moves on to
    // the next service.
    return null;
  },
  lookupPlaylist: async function (url, config) {
    var mapResult = function (p) {
      return {
        id: 'amazonmusic-playlist-' + (p.id || ''),
        name: p.name || 'Amazon Music Playlist',
        owner: p.owner || null,
        albumArt: p.albumArt || null,
        // The bridge reports the playlist's own trackCount; keep it so a
        // server-truncated import is visible instead of silently complete.
        trackCount: p.trackCount || p.tracks.length,
        url: url,
        tracks: p.tracks.map(function (t) {
          return {
            id: 'amazonmusic-' + t.asin,
            title: t.title,
            artist: t.artist,
            album: t.album,
            duration: t.duration || 0,
            sources: ['amazonmusic'],
            amazonAsin: t.asin,
            albumAsin: t.albumAsin || null,
          };
        }),
      };
    };
    var loaded = function (result) {
      return !!(
        result &&
        result.success &&
        result.playlist &&
        result.playlist.tracks &&
        result.playlist.tracks.length > 0
      );
    };
    var result = null;
    try {
      if (!window.electron || !window.electron.amazonMusic) {
        console.warn('Amazon Music: bridge not available');
        return null;
      }
      result = await window.electron.amazonMusic.lookupPlaylist(url);
      console.log(
        '[Amazon] resolver playlist lookup',
        url,
        result && result.success,
        result && result.reason,
        result && result.playlist && result.playlist.tracks && result.playlist.tracks.length,
      );
      if (loaded(result)) return mapResult(result.playlist);
      // Only a sign-in problem is fixed by sign-in. load-failed is a network
      // condition and no-cdm is a playback problem - importing needs neither -
      // and prompting for sign-in on either points the user at the wrong fix.
      if (result && result.reason === 'not-signed-in') {
        console.log('Amazon Music: not signed in, asking you to sign in...');
        var managed = false;
        if (typeof window.__parachordManageAmazonMusic === 'function') {
          managed = await window.__parachordManageAmazonMusic({
            explicit: true,
            reason: 'not-signed-in',
          });
        }
        if (managed) {
          result = await window.electron.amazonMusic.lookupPlaylist(url);
          if (loaded(result)) return mapResult(result.playlist);
        }
        var err = new Error(
          'Amazon Music is not signed in - sign in from Settings to import playlists',
        );
        err.notReady = true;
        err.code = 'not-signed-in';
        throw err;
      }
    } catch (error) {
      if (error && error.notReady) throw error;
      console.error('Amazon Music playlist lookup error:', error);
      return null;
    }
    // Outside the try so the catch does not swallow these.
    // Transient/wiring failures first: a stalled load must not be reported as a
    // missing playlist (or offered a sign-in prompt) - it is a network condition.
    var reason = result && result.reason;
    if (reason === 'load-failed' || reason === 'no-cdm' || reason === 'not-ready') {
      var transientErr = new Error(
        'Amazon Music is not reachable right now - check your connection and try again',
      );
      transientErr.notReady = true;
      transientErr.code = reason;
      throw transientErr;
    }
    if (result && result.success && result.playlist === null) {
      throw new Error(
        'Playlist not found on Amazon Music. It may have been deleted or made private.',
      );
    }
    if (result && result.error) {
      throw new Error('Amazon Music playlist import failed: ' + result.error);
    }
    if (result && result.success) {
      throw new Error(
        'Playlist not found on Amazon Music. It may have been deleted or made private.',
      );
    }
    return null;
  },
};
