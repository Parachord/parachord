// Source of truth for plugins/amazonmusic.axe v1.6.0.
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
        // plan-ineligible: the account isn't on Music Unlimited, so the host
        // offers no playable Amazon tracks (#1220). Not-ready rather than a
        // miss, so an upgrade re-resolves instead of finding cached misses.
        if (
          reason === 'not-ready' ||
          reason === 'not-signed-in' ||
          reason === 'no-cdm' ||
          reason === 'load-failed' ||
          reason === 'plan-ineligible'
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
    // The platform's gate (validateResolvedTrack in
    // sync-providers/confidence-scoring.js), copied because an .axe function can't
    // import it. A result dropped here never reaches that gate, so this has to
    // accept what it accepts: tests/resolver/plugin-credit-match.test.js holds the
    // two together over the shared credit vectors. No property-escape literal, which
    // would stop the whole function parsing on an engine without them: the guarded
    // constructor falls back to ASCII, so a non-Latin name misses instead.
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
    // match, ignoring feat. credits and how the credit is joined. Pass 2: a match
    // that is not another version (a version word the requested title lacks; the
    // list matches src/renderer/lib/track-variants.js). Pass 3: any match, since a
    // "Remastered" or live track by the right artist is still better than nothing
    // on a service whose catalog is the artist's own.
    var stripFeat = function (s) {
      return (s || '')
        .toString()
        .replace(/\s*[([]\s*(feat\.?|ft\.?|featuring)\s[^)\]]*[)\]]/gi, '')
        .replace(/\s+(feat\.?|ft\.?|featuring)\s.*$/i, '');
    };
    var VARIANT =
      /\b(live|medley|remix(es|ed)?|rmx|cover(s|ed)?|covering|tribute|karaoke|instrumental|acoustic|demo|unplugged|rework|bootleg|mashup|reprise|edit|jam track|sped up|slowed|in the style of)\b/gi;
    // A slash-joined title is a medley (#1306); joinsSongs in
    // sync-providers/track-variants.js.
    var joinsSongs = function (title) {
      if ((track || '').toString().indexOf('/') !== -1) return false;
      var s = (title || '').toString().toLowerCase();
      var a = (artist || '').toString().toLowerCase();
      if (a.indexOf('/') !== -1) s = s.split(a).join(' ');
      s = s.replace(/\bw\/\s*/g, ' ');
      return /[^\s\d]\s*\/\s*[^\s\d]/.test(s);
    };
    var isVariant = function (r) {
      if (joinsSongs(r.title)) return true;
      var words = ((r.title || '') + ' ' + (r.artist || '')).match(VARIANT) || [];
      var asked = ((track || '') + ' ' + (artist || '')).toLowerCase();
      for (var w = 0; w < words.length; w++) {
        if (asked.indexOf(words[w].toLowerCase()) === -1) return true;
      }
      return false;
    };
    var exactArtist = norm(stripFeat(artist));
    var exactTitle = norm(stripFeat(track));
    var requestedNames = creditedNames(artist);
    var sameCredit = function (credit) {
      var names = creditedNames(credit);
      return isSubset(names, requestedNames) && isSubset(requestedNames, names);
    };
    var matching = results.filter(matches);
    if (exactArtist && exactTitle) {
      for (var i = 0; i < matching.length; i++) {
        if (
          (norm(stripFeat(matching[i].artist)) === exactArtist || sameCredit(matching[i].artist)) &&
          norm(stripFeat(matching[i].title)) === exactTitle &&
          !isVariant(matching[i])
        )
          return matching[i];
      }
    }
    for (var j = 0; j < matching.length; j++) {
      if (!isVariant(matching[j])) return matching[j];
    }
    return matching[0] || null;
  },
  play: async function (track, config) {
    // Host-owned: with capabilities.widevine the host's handlePlay drives the
    // shared Widevine player (Shaka on the shared audio element, manifest and
    // license bytes via window.electron.widevine from the main-process dmls
    // provider). What used to live here — playTrack IPC, prompt-then-retry —
    // lives in the host's widevine branch, which also keeps the
    // not-signed-in → prompt → retry contract.
    console.log('Amazon Music: play() is host-owned (capabilities.widevine branch in handlePlay); not handled here');
    return false;
  },
  init: async function (config) {
    console.log('Amazon Music resolver initialized');
    return true;
  },
  cleanup: async function () {
    console.log('Amazon Music resolver cleanup');
    try {
      if (typeof window.__parachordWidevine === 'object' && typeof window.__parachordWidevine.stop === 'function') {
        await window.__parachordWidevine.stop();
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
  // capabilities.recommendations (docs/architecture/plugins.md,
  // "Recommendations"): the home page's "Albums for You" / "Your Frequent
  // Plays" style sections, each item typed by what Amazon sent
  // (docs/architecture/amazon-music.md, "Recommendations"). Miss policy like
  // the album catalog's: not-ready failures throw notReady (never cached as
  // a miss, never a sign-in prompt — the Recommendations page is background),
  // a real miss is empty sections. A host whose bridge predates the
  // capability is a quiet empty provider.
  getRecommendations: async function (config) {
    try {
      if (
        !window.electron ||
        !window.electron.amazonMusic ||
        typeof window.electron.amazonMusic.getRecommendations !== 'function'
      ) {
        return { sections: [] };
      }
      var result = await window.electron.amazonMusic.getRecommendations();
      if (!result || !result.success) {
        var reason = result && result.reason;
        if (reason) {
          // A readiness failure (or any unmapped failure — the page must never
          // cache a failure as a miss) is notReady, never a quiet miss.
          var err = new Error('Amazon Music not ready');
          err.notReady = true;
          err.code = reason;
          throw err;
        }
        return { sections: [] };
      }
      // Only the personal sections. Amazon's personal shelves are named
      // strategies ("…mp3YmlRecentPlaybackStrategy", "…playlistStrategy");
      // its editorial ones ("Top Playlists", "Featured This Week", "Amazon
      // Music Live", "Recently Played") carry UUID ids and the onboarding
      // shelf is GET_STARTED. The genre shelf ("Soundtracks") is a strategy
      // but a promo, so it is named out. Live-captured 2026-11-12.
      var EDITORIAL_STRATEGIES = { mp3GenreForYouStrategy: true };
      var strategyName = function (id) {
        return String(id || '').split('/').pop().replace(/^(browse|music)-home_/, '');
      };
      var isPersonal = function (id) {
        var last = strategyName(id);
        return /Strategy$/.test(last) && !EDITORIAL_STRATEGIES[last];
      };
      // The category the Recommendations page files a playlist section under.
      // Only the two playlist strategies say; the rest send none.
      var categoryOf = function (id) {
        var last = strategyName(id);
        if (last === 'playlistStrategy') return 'personal';
        if (last === 'mp3CommunityPlaylistsStrategy') return 'community';
        return undefined;
      };
      var sections = (result.sections || []).filter(function (s) {
        return s && Array.isArray(s.items) && s.items.length > 0 && isPersonal(s.id);
      }).map(function (s) {
        // The bridge's synthesized "Playlists for You" section carries its
        // first page's continuation cursor — pass it through so the page's
        // first "Load more" starts from it.
        var category = categoryOf(s.id);
        var out = s;
        if (s.nextCursor != null) {
          out = { id: s.id, title: s.title, description: s.description, items: s.items, nextCursor: String(s.nextCursor) };
        }
        if (category) out = Object.assign({}, out, { category: category });
        return out;
      });
      console.log(
        '[Amazon] resolver recommendations',
        sections.length,
        'sections,',
        sections.reduce(function (n, s) {
          return n + s.items.length;
        }, 0),
        'items',
      );
      return { sections: sections };
    } catch (error) {
      if (error && error.notReady) throw error;
      console.error('Amazon Music recommendations error:', error);
      return { sections: [] };
    }
  },
  // The "Load more" of a titled section (the see-more route, paginated by
  // the offset cursor the bridge returns). Same miss policy as
  // getRecommendations; an exhausted section answers no items and no cursor,
  // which the page renders as the end of the section.
  expandRecommendationSection: async function (sectionId, afterCursor, config) {
    try {
      if (
        !window.electron ||
        !window.electron.amazonMusic ||
        typeof window.electron.amazonMusic.expandRecommendationSection !== 'function'
      ) {
        return { items: [], nextCursor: null };
      }
      var id = (sectionId || '').trim();
      if (!id) return { items: [], nextCursor: null };
      var result = await window.electron.amazonMusic.expandRecommendationSection(id, afterCursor || null);
      if (!result || !result.success) {
        var reason = result && result.reason;
        if (reason) {
          var err = new Error('Amazon Music not ready');
          err.notReady = true;
          err.code = reason;
          throw err;
        }
        return { items: [], nextCursor: null };
      }
      var items = (result.items || []).filter(function (i) {
        return i && (i.name || i.title);
      });
      return { items: items, nextCursor: result.nextCursor || null };
    } catch (error) {
      if (error && error.notReady) throw error;
      console.error('Amazon Music recommendations see-more error:', error);
      return { items: [], nextCursor: null };
    }
  },
};
