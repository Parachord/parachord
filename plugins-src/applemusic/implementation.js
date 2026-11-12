// Source of truth for plugins/applemusic.axe v1.0.2.
// Imported from the .axe by `node scripts/build-axes.js --import`.
// Edit here, bump manifest.version in manifest.json, then run `node scripts/build-axes.js`.
// The functions materialize fully isolated (resolver-loader.js uses
// new Function) — no shared scope between them; helpers must be embedded per function.
module.exports = {
  search: async function (query, config) {
    try {
      if (query.trim().length < 2) {
        console.log('Query too short (min 2 chars)');
        return [];
      }
      const storefront = config.storefront || 'us';
      // The caller's lane (config.__lane: 'priority' for a play click,
      // 'background' for a cover lookup) for the host's MusicKit and iTunes
      // queues. A host without lanes ignores the extra argument.
      const lane = config && config.__lane;
      if (window.appleMusicSearchWithMusicKit) {
        return await window.appleMusicSearchWithMusicKit(query, storefront, 20, { lane: lane });
      }
      console.log('Searching Apple Music/iTunes for:', query);
      const response = await window.iTunesRateLimiter.fetch(
        'https://itunes.apple.com/search?term=' +
          encodeURIComponent(query) +
          '&media=music&entity=song&limit=20&country=' +
          storefront,
        lane === 'background' ? { background: true } : lane === 'priority' ? { priority: true } : undefined,
      );
      if (!response.ok) {
        console.error('iTunes search failed:', response.status);
        var unavailable = new Error('iTunes search failed: ' + response.status);
        unavailable.name = 'AppleMusicSearchUnavailable';
        unavailable.status = response.status;
        throw unavailable;
      }
      const data = await response.json();
      if (!data.results || data.results.length === 0) {
        console.log('No iTunes results found');
        return [];
      }
      const results = data.results.map(function (track) {
        return {
          id: 'applemusic-' + track.trackId,
          title: track.trackName,
          artist: track.artistName,
          album: track.collectionName || '',
          duration: Math.floor((track.trackTimeMillis || 0) / 1000),
          sources: ['applemusic'],
          appleMusicId: String(track.trackId),
          appleMusicUrl: track.trackViewUrl,
          albumArt: track.artworkUrl100 ? track.artworkUrl100.replace('100x100', '500x500') : null,
          previewUrl: track.previewUrl,
          genre: track.primaryGenreName,
          releaseDate: track.releaseDate,
          artistId: track.artistId,
          collectionId: track.collectionId,
          appleMusicAlbumUrl: track.collectionViewUrl || null,
          isStreamable: track.isStreamable,
        };
      });
      console.log('Found ' + results.length + ' Apple Music results');
      return results;
    } catch (error) {
      // An error is not "no results": an empty answer is cached as Apple
      // Music having no match for the track, so a refusal or an outage would
      // be remembered as a miss. Rethrown, every caller already catches it
      // (resolveTrack caches nothing for a resolver that threw).
      console.error('Apple Music search error:', error);
      throw error;
    }
  },
  // capabilities.recommendations (docs/architecture/plugins.md,
  // "Recommendations"): Apple Music's personal recommendations, GET
  // /v1/me/recommendations, through the host's account hook
  // (window.appleMusicPersonalRecommendations, which picks the user token Apple
  // accepts). Each of Apple's groups ("Playlists Made for You", "New Releases
  // for You", "More from <artist>", "<artist> Fans Like", genre and decade
  // picks) becomes a titled section of albums, playlists and songs; stations
  // (Parachord can't play them) and "Recently Played" (history, not a
  // recommendation) are left out, and a group of groups is flattened. Albums
  // carry Apple's releaseDate for the page's "Coming" badge. A host without
  // the hook (older apps, other platforms) is a quiet empty provider; a
  // refused or missing sign-in arrives as the hook's notReady error and is
  // rethrown, never answered as a miss.
  getRecommendations: async function (config) {
    if (typeof window === 'undefined' || typeof window.appleMusicPersonalRecommendations !== 'function') {
      return { sections: [] };
    }
    var body = await window.appleMusicPersonalRecommendations(30);
    var art = function (a) {
      var u = a && a.artwork && a.artwork.url;
      return u ? String(u).replace('{w}', '600').replace('{h}', '600').replace('{f}', 'jpg') : null;
    };
    // The personal mixes made from what the account already plays (Heavy
    // Rotation, Your Essentials, Favorites, Replay) aren't recommendations, so
    // they stay off the page, like Recently Played. Apple marks every personal
    // mix 'personal-mix' alike (Chill, Get Up! and New Music are discovery), so
    // these are told apart by name or URL slug, English only; Replay has its
    // own playlistType.
    var HISTORY_MIXES = ['heavy rotation', 'your essentials', 'favorites', 'favourites'];
    var isPlayHistoryMix = function (a) {
      if (a.playlistType === 'replay') return true;
      if (a.playlistType !== 'personal-mix') return false;
      var name = String(a.name || '').toLowerCase().replace(/ mix$/, '').trim();
      var slug = (String(a.url || '').match(/\/playlist\/([^/]+)\//) || [])[1] || '';
      slug = slug.replace(/-mix$/, '').replace(/-/g, ' ');
      return HISTORY_MIXES.indexOf(name) !== -1 || HISTORY_MIXES.indexOf(slug) !== -1;
    };
    var mapItem = function (c) {
      var a = c && c.attributes;
      if (!a || typeof a.name !== 'string' || !a.name.trim()) return null;
      if (c.type === 'albums') {
        return {
          type: 'album',
          id: 'applemusic-album-' + c.id,
          name: a.name,
          artist: a.artistName || '',
          imageUrl: art(a),
          url: a.url || null,
          releaseDate: a.releaseDate || null,
        };
      }
      if (c.type === 'playlists') {
        if (isPlayHistoryMix(a)) return null;
        return { type: 'playlist', id: 'applemusic-playlist-' + c.id, name: a.name, imageUrl: art(a), url: a.url || null };
      }
      if (c.type === 'songs') {
        var song = { type: 'song', name: a.name, artist: a.artistName || '', imageUrl: art(a), url: a.url || null };
        if (a.durationInMillis) song.duration = Math.round(a.durationInMillis / 1000);
        if (a.isrc) song.isrc = a.isrc;
        return song;
      }
      return null;
    };
    var sections = [];
    var addGroup = function (g, depth) {
      var ga = g && g.attributes;
      if (!ga || ga.kind === 'recently-played') return;
      var rel = g.relationships || {};
      var nested = rel.recommendations && rel.recommendations.data;
      if (Array.isArray(nested) && depth < 2) {
        nested.forEach(function (n) { addGroup(n, depth + 1); });
      }
      var contents = (rel.contents && rel.contents.data) || [];
      var items = contents.map(mapItem).filter(Boolean);
      if (!items.length) return;
      var title = (ga.title && ga.title.stringForDisplay) || 'Apple Music';
      sections.push({ id: 'applemusic:' + g.id, title: title, items: items });
    };
    ((body && body.data) || []).forEach(function (g) { addGroup(g, 0); });
    console.log('[AppleMusic] recommendations', sections.length, 'sections');
    return { sections: sections };
  },
  resolve: async function (artist, track, album, config) {
    // The platform's gate (validateResolvedTrack in
    // sync-providers/confidence-scoring.js), copied because an .axe function can't
    // import it. This plugin doesn't filter with it: the last line still hands back
    // the top result for the gate to judge. But resolve returns one track, so a wrong
    // artist ranked above the right one would be all the gate sees.
    // tests/resolver/plugin-credit-preference.test.js holds this to the shared credit
    // vectors. Android runs this function too (Tier 2 of its Apple Music resolver), so
    // no property-escape literal, which would stop the whole function parsing on an
    // engine without them: the guarded constructor falls back to ASCII, so a non-Latin
    // name misses here and reaches the top-result fallback.
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
    // The words need a space on both sides, so "Little Feat" and "Malcolm X" stay
    // whole. The brackets on a title credit are required: "ft" can be title text.
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
    var targetArtist = norm(artist);
    var targetTrack = norm(track);
    var requestedNames = creditedNames(artist);
    // What the gate accepts is wider than what was asked for: it also takes a shorter
    // title ("Stay" for "Stay With Me") and one name of a credit. So a result that
    // holds the whole request goes first, whichever way its credit is joined.
    var holdsRequest = function (r) {
      var names = creditedNames(r.artist);
      return (
        !!targetTrack &&
        norm(r.title).indexOf(targetTrack) !== -1 &&
        ((!!targetArtist && norm(r.artist).indexOf(targetArtist) !== -1) ||
          (isSubset(names, requestedNames) && isSubset(requestedNames, names)))
      );
    };
    var firstWhere = function (results, test) {
      for (var i = 0; i < results.length; i++) {
        if (test(results[i])) return results[i];
      }
      return null;
    };
    // The album search stops early only for the requested track itself: a looser match
    // here would end the resolve before the artist + title search below can find it.
    var matchFromResults = function (results) {
      return firstWhere(results, holdsRequest);
    };
    if (album) {
      if (!window._amAlbumCache) {
        window._amAlbumCache = {};
      }
      if (!window._amAlbumPending) {
        window._amAlbumPending = {};
      }
      var albumKey = norm(artist + '|' + album);
      var cached = window._amAlbumCache[albumKey];
      if (cached) {
        var match = matchFromResults(cached);
        if (match) {
          return match;
        }
      }
      if (!cached) {
        if (window._amAlbumPending[albumKey]) {
          var albumResults = await window._amAlbumPending[albumKey];
        } else {
          var self = this;
          var searchPromise = self.search(artist + ' ' + album, config);
          window._amAlbumPending[albumKey] = searchPromise;
          // A search that fails (iTunes refusing, a timeout) must leave the
          // pending map too: left there, every later track on the album would
          // await the same rejected search for the rest of the session.
          try {
            var albumResults = await searchPromise;
          } finally {
            delete window._amAlbumPending[albumKey];
          }
          window._amAlbumCache[albumKey] = albumResults;
          setTimeout(function () {
            delete window._amAlbumCache[albumKey];
          }, 60000);
        }
        var match = matchFromResults(albumResults);
        if (match) {
          return match;
        }
      }
    }
    var query = artist + ' ' + track;
    var results = await this.search(query, config);
    if (results.length === 0) return null;
    var match = matchFromResults(results) || firstWhere(results, matches);
    return match || results[0];
  },
  lookupUrl: async function (url, config) {
    try {
      console.log('Apple Music URL lookup:', url);
      var trackId = null;
      var albumIdMatch = url.match(/\/album\/[^/]+\/(\d+)/);
      var trackIdMatch = url.match(/[?&]i=(\d+)/);
      var songIdMatch = url.match(/\/song\/[^/]+\/(\d+)/);
      if (trackIdMatch) {
        trackId = trackIdMatch[1];
      } else if (songIdMatch) {
        trackId = songIdMatch[1];
      } else if (albumIdMatch && !trackIdMatch) {
        console.log('URL is for album, not track. Use lookupAlbum instead.');
        return null;
      }
      if (!trackId) {
        console.log('Could not extract track ID from URL');
        return null;
      }
      var storefront = config.storefront || 'us';
      if (window.appleMusicLookupSong) {
        return await window.appleMusicLookupSong(trackId, storefront);
      }
      var response = await window.iTunesRateLimiter.fetch(
        'https://itunes.apple.com/lookup?id=' + trackId + '&entity=song',
      );
      if (!response.ok) return null;
      var data = await response.json();
      if (!data.results || data.results.length === 0) return null;
      var track =
        data.results.find(function (r) {
          return r.wrapperType === 'track';
        }) || data.results[0];
      return {
        id: 'applemusic-' + track.trackId,
        title: track.trackName,
        artist: track.artistName,
        album: track.collectionName || '',
        duration: Math.floor((track.trackTimeMillis || 0) / 1000),
        sources: ['applemusic'],
        appleMusicId: String(track.trackId),
        appleMusicUrl: track.trackViewUrl || url,
        albumArt: track.artworkUrl100 ? track.artworkUrl100.replace('100x100', '500x500') : null,
        previewUrl: track.previewUrl,
        genre: track.primaryGenreName,
      };
    } catch (error) {
      console.error('Apple Music URL lookup error:', error);
      return null;
    }
  },
  // Album search for the catalog fallback (docs/architecture/plugins.md,
  // "searchAlbums"). Asks the host's appleMusicSearchAlbumsWithMusicKit for
  // Apple's catalog first: iTunes Search lags new releases by days or weeks
  // (and missed some albums for months). The hook returns null when it can't
  // reach the catalog, and then the public iTunes catalog answers, with no
  // Apple Music account or sign-in. Each result's url is a music.apple.com
  // album URL, which lookupAlbum below accepts.
  searchAlbums: async function (query, config) {
    try {
      var term =
        typeof query === 'string'
          ? query
          : [query && query.artist, query && query.title].filter(Boolean).join(' ');
      term = (term || '').trim();
      if (term.length < 2) return [];
      var storefront = (config && config.storefront) || 'us';
      var fetchAlbums = async function (t, limit) {
        if (window.appleMusicSearchAlbumsWithMusicKit) {
          var catalogAlbums = await window.appleMusicSearchAlbumsWithMusicKit(t, storefront, limit);
          if (Array.isArray(catalogAlbums)) return catalogAlbums;
        }
        var response = await window.iTunesRateLimiter.fetch(
          'https://itunes.apple.com/search?term=' +
            encodeURIComponent(t) +
            '&media=music&entity=album&limit=' +
            limit +
            '&country=' +
            storefront,
        );
        if (!response.ok) {
          console.warn('Apple Music album search failed:', response.status);
          return [];
        }
        var data = await response.json();
        return ((data && data.results) || [])
          .filter(function (a) {
            return a && a.collectionId && a.collectionName && a.collectionViewUrl;
          })
          .map(function (a) {
            return {
              id: 'applemusic-album-' + a.collectionId,
              name: a.collectionName,
              artist: a.artistName || '',
              albumArt: a.artworkUrl100 ? a.artworkUrl100.replace('100x100', '500x500') : null,
              releaseDate: a.releaseDate || null,
              trackCount: a.trackCount || null,
              url: a.collectionViewUrl,
            };
          });
      };
      var results = await fetchAlbums(term, 10);
      // A combined artist + title term can miss (iTunes matches it poorly),
      // so a miss is retried with the artist alone; the caller matches the
      // title.
      if (results.length === 0 && query && typeof query === 'object' && query.artist && query.title) {
        results = await fetchAlbums(String(query.artist).trim(), 50);
      }
      return results;
    } catch (error) {
      console.error('Apple Music album search error:', error);
      return [];
    }
  },
  lookupAlbum: async function (url, config) {
    try {
      console.log('Apple Music album lookup:', url);
      var albumIdMatch = url.match(/\/album\/[^/]+\/(\d+)/);
      if (!albumIdMatch) {
        console.log('Could not extract album ID from URL');
        return null;
      }
      var albumId = albumIdMatch[1];
      var storefront = config.storefront || 'us';
      if (window.appleMusicLookupAlbum) {
        var result = await window.appleMusicLookupAlbum(albumId, storefront);
        if (result) {
          result.url = url;
          return result;
        }
      }
      var response = await window.iTunesRateLimiter.fetch(
        'https://itunes.apple.com/lookup?id=' + albumId + '&entity=song&limit=200',
      );
      if (!response.ok) return null;
      var data = await response.json();
      if (!data.results || data.results.length === 0) return null;
      var albumInfo = data.results.find(function (r) {
        return r.wrapperType === 'collection';
      });
      var trackResults = data.results.filter(function (r) {
        return r.wrapperType === 'track';
      });
      var tracks = trackResults.map(function (track) {
        return {
          id: 'applemusic-' + track.trackId,
          title: track.trackName,
          artist: track.artistName,
          album: track.collectionName,
          duration: Math.floor((track.trackTimeMillis || 0) / 1000),
          sources: ['applemusic'],
          appleMusicId: String(track.trackId),
          appleMusicUrl: track.trackViewUrl,
          albumArt: track.artworkUrl100 ? track.artworkUrl100.replace('100x100', '500x500') : null,
          previewUrl: track.previewUrl,
          trackNumber: track.trackNumber,
          discNumber: track.discNumber,
        };
      });
      tracks.sort(function (a, b) {
        if (a.discNumber !== b.discNumber) return a.discNumber - b.discNumber;
        return a.trackNumber - b.trackNumber;
      });
      return {
        id: 'applemusic-album-' + albumId,
        name: albumInfo ? albumInfo.collectionName : 'Unknown Album',
        artist: albumInfo ? albumInfo.artistName : tracks[0] ? tracks[0].artist : 'Unknown Artist',
        albumArt:
          albumInfo && albumInfo.artworkUrl100
            ? albumInfo.artworkUrl100.replace('100x100', '500x500')
            : null,
        releaseDate: albumInfo ? albumInfo.releaseDate : null,
        trackCount: albumInfo ? albumInfo.trackCount : tracks.length,
        tracks: tracks,
        url: url,
      };
    } catch (error) {
      console.error('Apple Music album lookup error:', error);
      return null;
    }
  },
  lookupPlaylist: async function (url, config) {
    try {
      console.log('Apple Music playlist lookup:', url);
      var playlistIdMatch = url.match(/\/playlist\/[^/]+\/(pl\.[a-zA-Z0-9-]+)/);
      if (!playlistIdMatch) {
        console.log('Could not extract playlist ID from URL');
        return null;
      }
      var playlistId = playlistIdMatch[1];
      var storefront = config.storefront || 'us';
      if (window.appleMusicLookupPlaylist) {
        var result = await window.appleMusicLookupPlaylist(playlistId, storefront);
        if (result) {
          result.url = url;
          return result;
        }
      }
      console.log('MusicKit not available for playlist lookup');
      return null;
    } catch (error) {
      console.error('Apple Music playlist lookup error:', error);
      return null;
    }
  },
  play: async function (track, config) {
    console.log('[AppleMusic] Play called, track:', {
      id: track.id,
      appleMusicId: track.appleMusicId,
      hasUrl: !!track.appleMusicUrl,
      hasPreview: !!track.previewUrl,
    });
    var nativePlaySucceeded = false;
    if (window.electron && window.electron.musicKit && track.appleMusicId) {
      try {
        var authStatus = await window.electron.musicKit.checkAuth();
        console.log('[AppleMusic] Native auth status:', authStatus);
        if (authStatus.success && authStatus.authorized) {
          console.log('[AppleMusic] Playing via native MusicKit:', track.appleMusicId);
          // _startAt: a resumed track starts where it was. The helper answers
          // startTime when it applied it (an older one starts at 0:00), and
          // _startedAt tells the host, which then skips its own seek.
          var startAt = track._startAt > 0 ? track._startAt : 0;
          var playResult = startAt > 0
            ? await window.electron.musicKit.play(track.appleMusicId, startAt)
            : await window.electron.musicKit.play(track.appleMusicId);
          console.log('[AppleMusic] Native play result:', JSON.stringify(playResult));
          if (playResult.success) {
            if (startAt > 0 && playResult.startTime === startAt) track._startedAt = startAt;
            return true;
          }
          var errMsg = playResult.error || '';
          if (errMsg.indexOf('error 6') !== -1) {
            console.log(
              '[AppleMusic] Native MusicKit error 6 (system media session not ready). Open Music.app once to fix, or playback will use next available source.',
            );
            if (!window._appleMusicError6Notified) {
              window._appleMusicError6Notified = true;
              window.dispatchEvent(new CustomEvent('applemusic-session-error'));
            }
          } else {
            console.log('[AppleMusic] Native MusicKit play failed:', errMsg);
          }
          console.log('[AppleMusic] Native MusicKit play failed, falling back to MusicKit JS');
        }
      } catch (e) {
        console.log('[AppleMusic] Native MusicKit error:', e);
      }
    }
    if (!nativePlaySucceeded) {
      var musicKitWeb = window.getMusicKitWeb ? window.getMusicKitWeb() : null;
      if (musicKitWeb && track.appleMusicId) {
        var authCooldownMs = 300000;
        var lastAuthFailAt = window._appleMusicWebAuthFailedAt || 0;
        var inAuthCooldown = lastAuthFailAt && Date.now() - lastAuthFailAt < authCooldownMs;
        if (inAuthCooldown) {
          console.log(
            '[AppleMusic] Skipping MusicKit JS — auth failed ' +
              Math.round((Date.now() - lastAuthFailAt) / 1000) +
              's ago, cooling down',
          );
        } else {
          var status = musicKitWeb.getAuthStatus();
          if (!status.configured && window.electron && window.electron.config) {
            try {
              var devToken = await window.electron.config.get('MUSICKIT_DEVELOPER_TOKEN');
              if (devToken) {
                console.log('[AppleMusic] Auto-configuring MusicKit JS with developer token');
                await musicKitWeb.configure(devToken, 'Parachord', '1.0.0');
                status = musicKitWeb.getAuthStatus();
              }
            } catch (cfgErr) {
              console.log('[AppleMusic] MusicKit JS auto-configure failed:', cfgErr.message);
            }
          }
          console.log('[AppleMusic] MusicKit JS status:', status);
          if (
            status.configured &&
            !status.authorized &&
            window.electron &&
            window.electron.platform === 'darwin'
          ) {
            try {
              console.log('[AppleMusic] MusicKit JS not authorized, requesting authorization...');
              await musicKitWeb.authorize();
              status = musicKitWeb.getAuthStatus();
              console.log('[AppleMusic] MusicKit JS auth result:', status);
            } catch (authErr) {
              console.log('[AppleMusic] MusicKit JS authorization failed:', authErr.message);
              window._appleMusicWebAuthFailedAt = Date.now();
            }
          } else if (status.configured && !status.authorized) {
            console.log(
              '[AppleMusic] MusicKit JS not authorized; skipping popup on non-macOS (use Settings → Apple Music → Connect to sign in via the auth window). Falling back to 30s preview.',
            );
          }
          if (status.configured && status.authorized) {
            window._appleMusicWebAuthFailedAt = 0;
            try {
              console.log('[AppleMusic] Playing via MusicKit JS:', track.appleMusicId);
              await musicKitWeb.play(track.appleMusicId);
              console.log('[AppleMusic] MusicKit JS playback started');
              return true;
            } catch (mkError) {
              console.log('[AppleMusic] MusicKit JS play failed:', mkError.message);
            }
          }
        }
      }
    }
    if (track.previewUrl) {
      console.log('[AppleMusic] Trying 30-second preview in-app playback');
      try {
        if (!window._appleMusicPreviewAudio) {
          window._appleMusicPreviewAudio = new Audio();
          window._appleMusicPreviewAudio.addEventListener('ended', function () {
            console.log('[AppleMusic] Preview ended');
            if (window.dispatchEvent) {
              window.dispatchEvent(new CustomEvent('applemusic-preview-ended'));
            }
          });
        }
        window._appleMusicPreviewAudio.src = track.previewUrl;
        window._appleMusicPreviewAudio.volume = 1.0;
        await window._appleMusicPreviewAudio.play();
        console.log('[AppleMusic] Playing 30-second preview in-app');
        return true;
      } catch (audioError) {
        console.log('[AppleMusic] Preview playback failed:', audioError);
      }
    }
    console.log('[AppleMusic] All playback methods failed, returning false to try next source');
    return false;
  },
  init: async function (config) {
    console.log('Apple Music resolver initialized');
    if (config.developerToken && window.getMusicKitWeb) {
      console.log('[AppleMusic] Configuring MusicKit JS with developer token');
      try {
        var musicKitWeb = window.getMusicKitWeb();
        await musicKitWeb.configure(config.developerToken, 'Parachord', '1.0.0');
        console.log('[AppleMusic] MusicKit JS configured successfully');
        var status = musicKitWeb.getAuthStatus();
        if (!status.authorized) {
          console.log('[AppleMusic] MusicKit JS not authorized yet - will prompt on first play');
        }
      } catch (configError) {
        console.error('[AppleMusic] Failed to configure MusicKit JS:', configError);
      }
    }
    if (window.electron && window.electron.musicKit) {
      window.electron.musicKit.isAvailable().then(function (avail) {
        if (avail) {
          console.log('Native MusicKit available for Apple Music playback');
        }
      });
    }
  },
  cleanup: async function () {
    console.log('Apple Music resolver cleanup');
    var musicKitWeb = window.getMusicKitWeb ? window.getMusicKitWeb() : null;
    if (musicKitWeb) {
      try {
        await musicKitWeb.stop();
      } catch (e) {}
    }
  },
};
