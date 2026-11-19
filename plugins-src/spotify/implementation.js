// Source of truth for plugins/spotify.axe v1.2.5.
// Imported from the .axe by `node scripts/build-axes.js --import`.
// Edit here, bump manifest.version in manifest.json, then run `node scripts/build-axes.js`.
// The functions materialize fully isolated (resolver-loader.js uses
// new Function) — no shared scope between them; helpers must be embedded per function.
module.exports = {
  search: async function (query, config) {
    if (!config.token) return [];
    // A 429 is a refusal, never "no results": an empty answer is saved as
    // Spotify not having the track. Spotify's Retry-After (it can be hours) is
    // kept on the instance (docs/architecture/plugins.md, "State lives on
    // `this`"), shared with searchAlbums, and no search goes out until it has
    // passed: searching on prolongs the limit.
    const g = this;
    const rateLimited = () => {
      const err = new Error('Spotify asked for a pause in searches until ' + new Date(g.__parachordSpotifyRetryAt).toISOString());
      err.name = 'SpotifyRateLimited';
      err.status = 429;
      err.retryAt = g.__parachordSpotifyRetryAt;
      return err;
    };
    if (Date.now() < (g.__parachordSpotifyRetryAt || 0)) throw rateLimited();
    const doSearch = async (token) => {
      const response = await fetch(
        `https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!response.ok) {
        if (response.status === 429) {
          const seconds = parseInt((response.headers && response.headers.get('Retry-After')) || '5', 10) || 5;
          g.__parachordSpotifyRetryAt = Math.max(g.__parachordSpotifyRetryAt || 0, Date.now() + seconds * 1000);
          throw rateLimited();
        }
        let body = '';
        try {
          body = await response.text();
        } catch (e) {}
        console.error('Spotify search failed:', response.status, body);
        return { ok: false, status: response.status };
      }
      const data = await response.json();
      return { ok: true, items: data.tracks.items };
    };
    try {
      let result = await doSearch(config.token);
      if (!result.ok && result.status === 401 && config.refreshToken) {
        console.log('🔄 Spotify: Token expired, forcing refresh...');
        const newToken = await config.refreshToken();
        if (newToken && newToken !== config.token) {
          console.log('🔄 Spotify: Retrying search with refreshed token');
          result = await doSearch(newToken);
        }
      }
      if (!result.ok) {
        // A bad query (400) or nothing there (404) is no results; anything
        // else (a refused or expired sign-in, a server error) is Spotify not
        // answering, and must not be saved as a miss.
        if (result.status === 400 || result.status === 404) return [];
        const err = new Error('Spotify search refused: ' + result.status);
        err.status = result.status;
        throw err;
      }
      return result.items.map((track) => ({
        id: `spotify-${track.id}`,
        title: track.name,
        artist: track.artists.map((a) => a.name).join(', '),
        album: track.album.name,
        duration: Math.floor(track.duration_ms / 1000),
        sources: ['spotify'],
        spotifyUri: track.uri,
        spotifyId: track.id,
        // Spotify's 0-100 popularity; Search ranks with it (search-catalog.js)
        popularity: typeof track.popularity === 'number' ? track.popularity : undefined,
        spotifyAlbumId: track.album.id,
        albumArt: track.album.images[0]?.url,
        isrc:
          track.external_ids &&
          typeof track.external_ids.isrc === 'string' &&
          track.external_ids.isrc
            ? track.external_ids.isrc.trim().toUpperCase()
            : null,
      }));
    } catch (error) {
      console.error('Spotify search error:', error);
      throw error;
    }
  },
  resolve: async function (artist, track, album, config) {
    const clean = (s) => (s || '').replace(/["]/g, '').replace(/\s+/g, ' ').trim();
    const cleanArtist = clean(artist);
    const cleanTrack = clean(track);
    if (!cleanArtist && !cleanTrack) return null;
    let query = '';
    if (cleanArtist) query += `artist:"${cleanArtist}" `;
    if (cleanTrack) query += `track:"${cleanTrack}"`;
    query = query.trim();
    const results = await this.search(query, config);
    if (results.length > 0) return results[0];
    const fallbackQuery = `${cleanArtist} ${cleanTrack}`.trim();
    if (fallbackQuery && fallbackQuery !== query) {
      const fallbackResults = await this.search(fallbackQuery, config);
      return fallbackResults[0] || null;
    }
    return null;
  },
  lookupUrl: async function (url, config) {
    if (!config.token) return null;
    try {
      console.log('Spotify URL lookup:', url);
      var trackId = null;
      var m = url.match(/\/track\/([a-zA-Z0-9]+)/);
      if (m) trackId = m[1];
      if (!trackId) {
        m = url.match(/spotify:track:([a-zA-Z0-9]+)/);
        if (m) trackId = m[1];
      }
      if (!trackId) {
        console.log('Could not extract track ID from URL');
        return null;
      }
      const response = await fetch('https://api.spotify.com/v1/tracks/' + trackId, {
        headers: { Authorization: 'Bearer ' + config.token },
      });
      if (!response.ok) {
        console.error('Spotify track lookup failed:', response.status);
        return null;
      }
      const track = await response.json();
      return {
        id: 'spotify-' + track.id,
        title: track.name,
        artist: track.artists
          .map(function (a) {
            return a.name;
          })
          .join(', '),
        album: track.album.name,
        duration: Math.floor(track.duration_ms / 1000),
        sources: ['spotify'],
        spotifyUri: track.uri,
        spotifyId: track.id,
        spotifyAlbumId: track.album.id,
        albumArt: track.album.images[0] ? track.album.images[0].url : null,
        isrc:
          track.external_ids &&
          typeof track.external_ids.isrc === 'string' &&
          track.external_ids.isrc
            ? track.external_ids.isrc.trim().toUpperCase()
            : null,
      };
    } catch (error) {
      console.error('Spotify URL lookup error:', error);
      return null;
    }
  },
  // Album search for the catalog fallback (docs/architecture/plugins.md,
  // "searchAlbums"). Needs a signed-in token, like search. Each result's url
  // is an open.spotify.com album URL, which lookupAlbum below accepts.
  searchAlbums: async function (query, config) {
    if (!config || !config.token) return [];
    var q;
    if (typeof query === 'string') {
      q = query.trim();
    } else {
      var parts = [];
      if (query && query.title) parts.push('album:"' + String(query.title).replace(/"/g, '') + '"');
      if (query && query.artist) parts.push('artist:"' + String(query.artist).replace(/"/g, '') + '"');
      q = parts.join(' ');
    }
    if (!q || q.length < 2) return [];
    // The same pause as search (this.__parachordSpotifyRetryAt): no request
    // while it lasts, and a 429 here starts it too.
    var g = this;
    if (Date.now() < (g.__parachordSpotifyRetryAt || 0)) return [];
    var doSearch = async function (token) {
      var response = await fetch(
        'https://api.spotify.com/v1/search?q=' + encodeURIComponent(q) + '&type=album&limit=10',
        { headers: { Authorization: 'Bearer ' + token } },
      );
      if (response.status === 429) {
        var seconds = parseInt((response.headers && response.headers.get('Retry-After')) || '5', 10) || 5;
        g.__parachordSpotifyRetryAt = Math.max(g.__parachordSpotifyRetryAt || 0, Date.now() + seconds * 1000);
      }
      if (!response.ok) return { ok: false, status: response.status };
      var data = await response.json();
      return { ok: true, items: (data && data.albums && data.albums.items) || [] };
    };
    try {
      var result = await doSearch(config.token);
      if (!result.ok && result.status === 401 && config.refreshToken) {
        var newToken = await config.refreshToken();
        if (newToken && newToken !== config.token) result = await doSearch(newToken);
      }
      if (!result.ok) {
        console.warn('Spotify album search failed:', result.status);
        return [];
      }
      return result.items
        .filter(function (a) {
          return a && a.id && a.name;
        })
        .map(function (a) {
          return {
            id: 'spotify-album-' + a.id,
            name: a.name,
            artist: (a.artists || [])
              .map(function (x) {
                return x.name;
              })
              .join(', '),
            albumArt: a.images && a.images[0] ? a.images[0].url : null,
            releaseDate: a.release_date || null,
            trackCount: a.total_tracks || null,
            url: (a.external_urls && a.external_urls.spotify) || 'https://open.spotify.com/album/' + a.id,
          };
        });
    } catch (error) {
      console.error('Spotify album search error:', error);
      return [];
    }
  },
  lookupAlbum: async function (url, config) {
    if (!config.token) return null;
    try {
      console.log('Spotify album lookup:', url);
      var albumId = null;
      var m = url.match(/\/album\/([a-zA-Z0-9]+)/);
      if (m) albumId = m[1];
      if (!albumId) {
        m = url.match(/spotify:album:([a-zA-Z0-9]+)/);
        if (m) albumId = m[1];
      }
      if (!albumId) {
        console.log('Could not extract album ID from URL');
        return null;
      }
      const albumResponse = await fetch('https://api.spotify.com/v1/albums/' + albumId, {
        headers: { Authorization: 'Bearer ' + config.token },
      });
      if (!albumResponse.ok) {
        console.error('Spotify album lookup failed:', albumResponse.status);
        return null;
      }
      const album = await albumResponse.json();
      var tracks = album.tracks.items.map(function (track) {
        return {
          id: 'spotify-' + track.id,
          title: track.name,
          artist: track.artists
            .map(function (a) {
              return a.name;
            })
            .join(', '),
          album: album.name,
          duration: Math.floor(track.duration_ms / 1000),
          sources: ['spotify'],
          spotifyUri: track.uri,
          spotifyId: track.id,
          spotifyAlbumId: album.id,
          albumArt: album.images[0] ? album.images[0].url : null,
          trackNumber: track.track_number,
          discNumber: track.disc_number,
        };
      });
      tracks.sort(function (a, b) {
        if (a.discNumber !== b.discNumber) return a.discNumber - b.discNumber;
        return a.trackNumber - b.trackNumber;
      });
      return {
        id: 'spotify-album-' + albumId,
        name: album.name,
        artist: album.artists
          .map(function (a) {
            return a.name;
          })
          .join(', '),
        albumArt: album.images[0] ? album.images[0].url : null,
        releaseDate: album.release_date,
        trackCount: album.total_tracks,
        tracks: tracks,
        url: url,
      };
    } catch (error) {
      console.error('Spotify album lookup error:', error);
      return null;
    }
  },
  lookupPlaylist: async function (url, config) {
    var playlistId = null;
    var m = url.match(/\/playlist\/([a-zA-Z0-9]+)/);
    if (m) playlistId = m[1];
    if (!playlistId) {
      m = url.match(/spotify:playlist:([a-zA-Z0-9]+)/);
      if (m) playlistId = m[1];
    }
    if (!playlistId) {
      console.log('Could not extract playlist ID from URL');
      return null;
    }
    var apiError = null;
    if (config.token) {
      try {
        var allTracks = [];
        var nextUrl = 'https://api.spotify.com/v1/playlists/' + playlistId + '/tracks?limit=100';
        var playlistName = '';
        var playlistImage = null;
        var playlistOwner = '';
        var playlistResp = await fetch(
          'https://api.spotify.com/v1/playlists/' +
            playlistId +
            '?fields=name,images,owner(display_name)',
          { headers: { Authorization: 'Bearer ' + config.token } },
        );
        if (playlistResp.ok) {
          var playlistData = await playlistResp.json();
          playlistName = playlistData.name || '';
          playlistImage =
            playlistData.images && playlistData.images[0] ? playlistData.images[0].url : null;
          playlistOwner =
            playlistData.owner && playlistData.owner.display_name
              ? playlistData.owner.display_name
              : '';
        } else if (playlistResp.status === 403) {
          var errBody = '';
          try {
            errBody = await playlistResp.text();
            console.error('Spotify playlist 403 response:', errBody);
          } catch (e) {}
          apiError = 'metadata-403';
        } else if (playlistResp.status === 404) {
          apiError = 'not-found';
        }
        if (!apiError) {
          while (nextUrl) {
            var response = await fetch(nextUrl, {
              headers: { Authorization: 'Bearer ' + config.token },
            });
            if (!response.ok) {
              console.error('Spotify playlist tracks fetch failed:', response.status);
              if (response.status === 403) {
                var tErrBody = '';
                try {
                  tErrBody = await response.text();
                  console.error('Spotify playlist tracks 403 response:', tErrBody);
                } catch (e) {}
                apiError = 'tracks-403';
                break;
              }
              break;
            }
            var data = await response.json();
            var items = data.items || [];
            for (var i = 0; i < items.length; i++) {
              var item = items[i];
              if (!item.track || item.track.type !== 'track') continue;
              var track = item.track;
              allTracks.push({
                id: 'spotify-' + track.id,
                title: track.name,
                artist: track.artists
                  .map(function (a) {
                    return a.name;
                  })
                  .join(', '),
                album: track.album.name,
                duration: Math.floor(track.duration_ms / 1000),
                sources: ['spotify'],
                spotifyUri: track.uri,
                spotifyId: track.id,
                spotifyAlbumId: track.album.id,
                albumArt: track.album.images[0] ? track.album.images[0].url : null,
                isrc:
                  track.external_ids &&
                  typeof track.external_ids.isrc === 'string' &&
                  track.external_ids.isrc
                    ? track.external_ids.isrc.trim().toUpperCase()
                    : null,
              });
            }
            nextUrl = data.next;
          }
        }
        if (!apiError && allTracks.length > 0) {
          console.log(
            'Spotify playlist loaded:',
            playlistName,
            '(' + allTracks.length + ' tracks)',
          );
          return {
            id: 'spotify-playlist-' + playlistId,
            name: playlistName,
            owner: playlistOwner,
            albumArt: playlistImage,
            trackCount: allTracks.length,
            tracks: allTracks,
            url: url,
          };
        }
      } catch (error) {
        console.error('Spotify API playlist error:', error);
        apiError = apiError || 'api-error';
      }
    } else {
      apiError = 'no-token';
    }
    if (apiError) {
      console.log('Spotify API failed (' + apiError + '), trying embed page scrape fallback...');
      if (window.electron && window.electron.spotify && window.electron.spotify.scrapePlaylist) {
        try {
          var scrapeResult = await window.electron.spotify.scrapePlaylist(playlistId);
          if (
            scrapeResult &&
            scrapeResult.success &&
            scrapeResult.playlist &&
            scrapeResult.playlist.tracks &&
            scrapeResult.playlist.tracks.length > 0
          ) {
            console.log(
              '✅ Embed scrape fallback succeeded:',
              scrapeResult.playlist.name,
              '(' + scrapeResult.playlist.tracks.length + ' tracks)',
            );
            return scrapeResult.playlist;
          } else {
            console.error(
              'Embed scrape returned no tracks:',
              scrapeResult ? scrapeResult.error : 'null result',
            );
          }
        } catch (scrapeError) {
          console.error('Embed scrape fallback failed:', scrapeError);
        }
      } else {
        console.log('Embed scrape not available (no electron.spotify.scrapePlaylist)');
      }
      if (apiError === 'not-found') {
        throw new Error('Playlist not found on Spotify. It may have been deleted or made private.');
      } else if (apiError.includes('403')) {
        throw new Error(
          'Spotify denied access to this playlist via API, and the embed fallback also failed. This is usually caused by Spotify Developer Mode restrictions. Try importing one of your own playlists.',
        );
      } else {
        throw new Error('Could not load playlist from Spotify.');
      }
    }
    return null;
  },
  play: async function (track, config) {
    if (!config.token) {
      console.error('Spotify not connected');
      return false;
    }
    let token = config.token;
    async function tryPlay(t) {
      const devicesResponse = await fetch('https://api.spotify.com/v1/me/player/devices', {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (!devicesResponse.ok) {
        if (devicesResponse.status === 401) return { needsRefresh: true };
        return { success: false };
      }
      const devicesData = await devicesResponse.json();
      const devices = devicesData.devices || [];
      if (devices.length === 0) {
        console.error('No Spotify devices found');
        return { success: false };
      }
      const controllable = devices.filter((d) => !d.is_restricted);
      const available = controllable.length > 0 ? controllable : devices;
      const computer = available.find((d) => d.type === 'Computer');
      const phone = available.find((d) => d.type === 'Smartphone');
      const speaker = available.find((d) => d.type === 'Speaker');
      const nonWebActive = available.find(
        (d) => d.is_active && !d.name.toLowerCase().includes('web'),
      );
      const nonWeb = available.find((d) => !d.name.toLowerCase().includes('web'));
      let activeDevice = computer || phone || speaker || nonWebActive || nonWeb || available[0];
      console.log('Selected device:', activeDevice.name, activeDevice.type);
      if (!activeDevice.is_active) {
        const transferResponse = await fetch('https://api.spotify.com/v1/me/player', {
          method: 'PUT',
          headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ device_ids: [activeDevice.id], play: true }),
        });
        if (!transferResponse.ok && transferResponse.status !== 204) {
          console.error('Failed to transfer playback');
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      // Start the track inside its album (context_uri + offset), not as a bare
      // `uris` list (parachord#1300): Spotify's Android app (9.2, Nov 2026)
      // answers a bare-uris play with 204 and then plays nothing, while the
      // album form plays at once there and everywhere else. The album id comes
      // from the track (search and album/playlist lookups carry it), else one
      // GET /v1/tracks/{id}, remembered per track. That lookup sends no market,
      // so the offset is the track's own uri and the pollers' uri checks hold.
      // A failed lookup, or a refused album play, plays the bare track.
      const uri = track.spotifyUri;
      const bareBody = { uris: [uri] };
      const albumBody = async () => {
        const m = /^spotify:track:([A-Za-z0-9]+)$/.exec(uri || '');
        if (!m) return null;
        let albumId = track.spotifyAlbumId || null;
        if (!albumId) {
          const g = typeof window !== 'undefined' ? window : globalThis;
          if (!g._spotifyTrackAlbums) g._spotifyTrackAlbums = new Map();
          const cache = g._spotifyTrackAlbums;
          if (cache.has(m[1])) {
            albumId = cache.get(m[1]);
          } else {
            try {
              const r = await fetch(`https://api.spotify.com/v1/tracks/${m[1]}`, {
                headers: { Authorization: `Bearer ${t}` },
              });
              if (!r.ok) return null;
              const data = await r.json();
              albumId = (data && data.album && data.album.id) || null;
              cache.set(m[1], albumId);
              while (cache.size > 500) cache.delete(cache.keys().next().value);
            } catch (_e) {
              return null;
            }
          }
        }
        return albumId ? { context_uri: `spotify:album:${albumId}`, offset: { uri } } : null;
      };
      let body = (await albumBody()) || bareBody;
      // _startAt: a resumed track starts where it was, not at 0:00 then a
      // seek. Spotify honours position_ms on both bodies. Set in place: the
      // album fallback below compares body with bareBody.
      if (track._startAt > 0) {
        const positionMs = Math.round(track._startAt * 1000);
        body.position_ms = positionMs;
        bareBody.position_ms = positionMs;
      }
      const sendPlay = () =>
        fetch(`https://api.spotify.com/v1/me/player/play?device_id=${activeDevice.id}`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      let playResponse = await sendPlay();
      if (playResponse.status === 401) return { needsRefresh: true };
      if (!playResponse.ok && playResponse.status !== 204 && body !== bareBody) {
        console.warn('Spotify refused the album play (' + playResponse.status + '), playing the bare track');
        body = bareBody;
        playResponse = await sendPlay();
        if (playResponse.status === 401) return { needsRefresh: true };
      }
      if (!playResponse.ok && playResponse.status !== 204) return { success: false };
      const matches = (item) =>
        !!item &&
        (item.uri === track.spotifyUri ||
          (!!item.linked_from && item.linked_from.uri === track.spotifyUri));
      const waitForPlayback = async (timeoutMs) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          try {
            const stateResponse = await fetch('https://api.spotify.com/v1/me/player', {
              headers: { Authorization: `Bearer ${t}` },
            });
            if (stateResponse.status === 200) {
              const state = await stateResponse.json();
              if (state && state.is_playing && matches(state.item)) return true;
            }
          } catch (e) {}
        }
        return false;
      };
      if (await waitForPlayback(5000)) return { success: true };
      console.warn(
        'Spotify accepted play but playback has not started on',
        activeDevice.name,
        '- sending play again (parachord#985)',
      );
      const retryResponse = await sendPlay();
      if (!retryResponse.ok && retryResponse.status !== 204) {
        console.error('Spotify play retry failed:', retryResponse.status);
        return { success: false };
      }
      if (await waitForPlayback(4000)) return { success: true };
      console.warn(
        'Spotify playback still not confirmed on',
        activeDevice.name,
        '- leaving it to the playback poller',
      );
      return { success: true };
    }
    // A play that started tells the host it started at _startAt (position_ms
    // went with it), so the host doesn't seek there again.
    const done = (r) => {
      const ok = !!(r && r.success);
      if (ok && track._startAt > 0) track._startedAt = track._startAt;
      return ok;
    };
    try {
      const result = await tryPlay(token);
      if (result.needsRefresh && config.refreshToken) {
        console.log('🔄 Spotify play: Token expired, refreshing...');
        const newToken = await config.refreshToken();
        if (newToken && newToken !== token) {
          console.log('🔄 Spotify play: Retrying with refreshed token');
          const retryResult = await tryPlay(newToken);
          return done(retryResult);
        }
      }
      return done(result);
    } catch (error) {
      console.error('Spotify play error:', error);
      return false;
    }
  },
  // The artistReleases capability (#1539 step 2): the artist page's
  // discography when MusicBrainz is slow or doesn't know the artist, moved
  // out of app.js (fetchArtistFromSpotify). artist: { name }. Answers
  // { artist: { name }, releases: [{ id, title, date, releaseType, albumArt }] }
  // with Spotify's own album ids (the app prefixes them "spotify-"), or null
  // when Spotify doesn't know the artist. Signed out, or a failed request,
  // THROWS.
  getArtistReleases: async function (artist, config) {
    var name = artist && typeof artist.name === 'string' ? artist.name.trim() : '';
    if (!name) return null;
    if (!config || !config.token) throw new Error('Spotify artist releases: not signed in');
    var g = this;
    if (Date.now() < (g.__parachordSpotifyRetryAt || 0)) throw new Error('Spotify artist releases: rate limited');
    // The result whose name is the asked one: the same name ignoring case,
    // else every word of the shorter name in the longer, else the first. The
    // app checks the name again, so this only chooses among the results.
    var lower = function (s) { return String(s || '').trim().toLowerCase(); };
    var words = function (s) {
      var out = lower(s);
      try { out = out.normalize('NFD').replace(/[̀-ͯ]/g, ''); } catch (_e) { /* old engines */ }
      return out.replace(/\s*\(\d+\)$/, '').replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
    };
    var sameWords = function (a, b) {
      var x = words(a);
      var y = words(b);
      var shorter = x.length <= y.length ? x : y;
      var longer = x.length <= y.length ? y : x;
      return shorter.length > 0 && shorter.every(function (w) { return longer.indexOf(w) !== -1; });
    };
    var pickArtist = function (list, nameOf) {
      return list.find(function (a) { return lower(nameOf(a)) === lower(name); })
        || list.find(function (a) { return sameWords(nameOf(a), name); })
        || list[0] || null;
    };
    var get = async function (url) {
      var ask = function (token) { return fetch(url, { headers: { Authorization: 'Bearer ' + token } }); };
      var response = await ask(config.token);
      if (response.status === 401 && config.refreshToken) {
        var newToken = await config.refreshToken();
        if (newToken && newToken !== config.token) response = await ask(newToken);
      }
      if (response.status === 429) {
        var seconds = parseInt((response.headers && response.headers.get('Retry-After')) || '5', 10) || 5;
        g.__parachordSpotifyRetryAt = Math.max(g.__parachordSpotifyRetryAt || 0, Date.now() + seconds * 1000);
      }
      if (!response.ok) throw new Error('Spotify artist releases failed: ' + response.status);
      return response.json();
    };
    var search = await get('https://api.spotify.com/v1/search?q=' + encodeURIComponent('artist:"' + name.replace(/"/g, '') + '"') + '&type=artist&limit=5');
    var found = pickArtist((search && search.artists && search.artists.items) || [], function (a) { return a && a.name; });
    if (!found || !found.id) return null;
    var albums = await get('https://api.spotify.com/v1/artists/' + encodeURIComponent(found.id) + '/albums?include_groups=album,single&limit=50&market=US');
    var releases = ((albums && albums.items) || []).filter(function (a) { return a && a.id && a.name; }).map(function (a) {
      var type = a.album_group || a.album_type || 'album';
      return {
        id: a.id,
        title: a.name,
        date: a.release_date || null,
        releaseType: type === 'single' ? 'single' : (type === 'compilation' ? 'compilation' : 'album'),
        albumArt: (a.images && a.images[0] && a.images[0].url) || null
      };
    });
    return { artist: { name: found.name }, releases: releases };
  },
  init: async function (config) {
    console.log('Spotify resolver initialized');
  },
  cleanup: async function () {
    console.log('Spotify resolver cleanup');
  },
};
