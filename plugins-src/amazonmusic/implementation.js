// Source of truth for plugins/amazonmusic.axe v1.4.2.
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
    for (var i = 0; i < results.length; i++) {
      if (
        contains(norm(results[i].artist), targetArtist) &&
        contains(norm(results[i].title), targetTitle)
      )
        return results[i];
    }
    return null;
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
