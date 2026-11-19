// Source of truth for plugins/bandcamp.axe v1.4.5.
// Imported from the .axe by `node scripts/build-axes.js --import`.
// Edit here, bump manifest.version in manifest.json, then run `node scripts/build-axes.js`.
// The functions materialize fully isolated (resolver-loader.js uses
// new Function) — no shared scope between them; helpers must be embedded per function,
// or be a method reached through `this` (isStreamable and noteStreamable, which
// keep the session's streaming answers on the resolver object).
module.exports = {
  // limit: how many results to keep (default 20, a page of search results).
  // resolve asks for every row the API returns (it returns up to 50): the
  // artist's own recording often ranks below 20 remixes and covers ("Radiohead
  // Nude": the In Rainbows track is row 31), and a 20-row cut left resolve
  // only rows the confidence gate rejects (#1532).
  //
  // Only tracks that stream are returned: an artist can make a track
  // buy-only, and the search API doesn't say which. Each result is checked
  // with isStreamable (below), five at a time, and one that doesn't stream is
  // dropped; one whose check failed, or that has no band id to check with
  // (the app_autocomplete fallback's rows can lack it), is kept. resolve
  // passes options.streamCheck false and checks only the rows it picks.
  search: async function (query, config, limit, options) {
    var maxResults = typeof limit === 'number' && limit > 0 ? limit : 20;
    var checkStreams = !(options && options.streamCheck === false) && typeof this.isStreamable === 'function';
    var self = this;
    // parachord#977: Bandcamp's HTML search page (bandcamp.com/search) now serves a
    // bot "Client Challenge" page, so scraping it returns nothing. Use the JSON API
    // that bandcamp.com's own search box calls (tracks only), falling back to the
    // mobile-app autocomplete endpoint if it errors or comes back empty.
    var normalizeUrl = function (u) {
      if (typeof u !== 'string' || !u) return null;
      // app_autocomplete returns a doubled url ("https://x.bandcamp.comhttps://x.bandcamp.com/track/y"); keep the last absolute URL.
      var i = u.lastIndexOf('https://');
      return i > 0 ? u.slice(i) : u;
    };
    // Cover art for a search result. The search API's img field names the
    // image without the "a" prefix album art lives under, so it 404s at every
    // size (img/2732951243_3.jpg); img/a<art_id>_10.jpg is the 1200px cover.
    // Each exported function is serialized on its own, so this is repeated
    // in search and searchAlbums.
    var bandcampArtUrl = function (r) {
      if (r && r.art_id) return 'https://f4.bcbits.com/img/a' + r.art_id + '_10.jpg';
      return r && r.img ? r.img.replace('_3.jpg', '_10.jpg') : null;
    };
    var toResult = function (r) {
      if (!r || !r.name) return null;
      var url = normalizeUrl(r.item_url_path || r.url);
      if (!url) return null;
      return {
        id: 'bandcamp-' + (r.id || url),
        title: r.name,
        artist: r.band_name || 'Unknown Artist',
        album: r.album_name || '',
        // The search API carries no length, and fetching every result's page
        // to read one is too slow for search. Unknown is null: a made-up 210
        // showed as the track's length in every track list (#1412).
        duration: null,
        sources: ['bandcamp'],
        bandcampUrl: url,
        purchaseUrl: url,
        bandcampTrackId: r.id || null,
        bandcampAlbumId: r.album_id || null,
        bandcampBandId: r.band_id || null,
        albumArt: bandcampArtUrl(r),
      };
    };
    try {
      console.log('Searching Bandcamp for:', query);
      var items = [];
      try {
        var resp = await fetch(
          'https://bandcamp.com/api/bcsearch_public_api/1/autocomplete_elastic',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              search_text: query,
              search_filter: 't',
              full_page: false,
              fan_id: null,
            }),
          },
        );
        if (resp.ok) {
          var data = await resp.json();
          items = (data && data.auto && data.auto.results) || [];
        } else {
          console.warn('Bandcamp search API returned', resp.status);
        }
      } catch (e) {
        console.warn('Bandcamp search API error:', e && e.message);
      }
      if (items.length === 0) {
        try {
          var resp2 = await fetch(
            'https://bandcamp.com/api/fuzzysearch/1/app_autocomplete?q=' +
              encodeURIComponent(query),
          );
          if (resp2.ok) {
            var data2 = await resp2.json();
            items = ((data2 && data2.results) || []).filter(function (x) {
              return x && x.type === 't';
            });
          }
        } catch (e2) {
          console.warn('Bandcamp autocomplete fallback error:', e2 && e2.message);
        }
      }
      var results = [];
      for (var i = 0; i < items.length && results.length < maxResults; i++) {
        var t = toResult(items[i]);
        if (t) results.push(t);
      }
      if (checkStreams && results.length > 0) {
        var verdicts = [];
        var next = 0;
        var checkNext = async function () {
          while (next < results.length) {
            var k = next++;
            var row = results[k];
            verdicts[k] =
              row.bandcampBandId && row.bandcampTrackId
                ? await self.isStreamable(row.bandcampBandId, row.bandcampTrackId, row.bandcampUrl)
                : null;
          }
        };
        var workers = [];
        for (var w = 0; w < 5 && w < results.length; w++) workers.push(checkNext());
        await Promise.all(workers);
        results = results.filter(function (row, k) {
          return verdicts[k] !== false;
        });
      }
      console.log('Found ' + results.length + ' Bandcamp results');
      return results;
    } catch (error) {
      console.error('Bandcamp search error:', error);
      return [];
    }
  },
  resolve: async function (artist, track, album, config) {
    // Prefer the first result the platform's gate would accept
    // (validateResolvedTrack in sync-providers/confidence-scoring.js, copied because
    // an .axe function can't import it), so the downstream 0.6 confidence floor
    // doesn't drop a correct match that isn't ranked first. This is only a ranking
    // hint, and the gate still has the last word on whatever comes back:
    // tests/resolver/plugin-credit-preference.test.js holds it to the shared credit
    // vectors. This .axe also runs in the mobile JS runtime, so no property-escape
    // literal, which would stop the whole function parsing on an engine without them.
    // The guarded constructor falls back to ASCII, where non-Latin names normalize to
    // '' and fall through to the top result that is not another version.
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
    var requestedNames = creditedNames(artist);
    var sameCredit = function (credit) {
      var names = creditedNames(credit);
      return isSubset(names, requestedNames) && isSubset(requestedNames, names);
    };
    //
    // Bandcamp's search API ranks covers, remixes and live versions by other
    // uploaders alongside (often above) the original, and containment accepts
    // all of them: "Dear Prudence (Cover)" contains "Dear Prudence", and
    // "Steven Gilpin (covering the Foo Fighters)" contains "Foo Fighters". The
    // first containment hit used to win, so the playbar's Buy link pointed at
    // "Cleopatra (Live from Wrigley Field)" while plain "Cleopatra" sat lower
    // in the same results. So: an exact match first, however the credit is
    // joined, then a match the gate would accept that is not a different version
    // (a version word the requested title doesn't have, in the title or the
    // uploader's name), else nothing.
    var stripFeat = function (s) {
      return (s || '')
        .toString()
        .replace(/\s*[([]\s*(feat\.?|ft\.?|featuring)\s[^)\]]*[)\]]/gi, '')
        .replace(/\s+(feat\.?|ft\.?|featuring)\s.*$/i, '');
    };
    var VARIANT =
      /\b(live|medley|remix(es|ed)?|rmx|cover(s|ed)?|covering|tribute|karaoke|instrumental|acoustic|demo|unplugged|rework|bootleg|mashup|reprise|edit|jam track|sped up|slowed|in the style of)\b/gi;
    // A version word counts only when the requested name lacks it, so
    // "Live Forever" or "Take Me Out (Live)" can still match themselves.
    var hasVariant = function (s, target) {
      var words = (s || '').toString().match(VARIANT) || [];
      var t = (target || '').toString().toLowerCase();
      for (var w = 0; w < words.length; w++) {
        if (t.indexOf(words[w].toLowerCase()) === -1) return true;
      }
      return false;
    };
    // A slash-joined title is a medley ("You Never Give Me Your Money/Sun
    // King/.../Her Majesty", #1306), unless the requested title has a slash, the
    // slash is between digits ("24/7"), is "w/", or is in the requested artist's
    // name ("AC/DC - Back in Black"). joinsSongs in sync-providers/track-variants.js.
    var joinsSongs = function (title) {
      if ((track || '').toString().indexOf('/') !== -1) return false;
      var s = (title || '').toString().toLowerCase();
      var a = (artist || '').toString().toLowerCase();
      if (a.indexOf('/') !== -1) s = s.split(a).join(' ');
      s = s.replace(/\bw\/\s*/g, ' ');
      return /[^\s\d]\s*\/\s*[^\s\d]/.test(s);
    };
    var targetArtist = norm(stripFeat(artist));
    var targetTitle = norm(stripFeat(track));
    var isVariant = function (r) {
      return hasVariant(r.title, track) || hasVariant(r.artist, artist) || joinsSongs(r.title);
    };
    var startedAt = Date.now();
    // Every row the search API returns, not the search page's 20: the
    // original often ranks below a page of remixes and covers (#1532).
    // Unchecked: only the rows picked below are checked for streaming.
    var results = await this.search(((artist || '') + ' ' + (track || '')).trim(), config, 50, {
      streamCheck: false,
    });
    if (results.length === 0) return null;
    // The candidates, best first: exact matches, then the other matches the
    // gate would accept that are not another version. With none of those, the
    // results that are not another version (and the confidence gate decides).
    var candidates = [];
    var i;
    if (targetArtist && targetTitle) {
      for (i = 0; i < results.length; i++) {
        var ra = norm(stripFeat(results[i].artist));
        var rt = norm(stripFeat(results[i].title));
        // Label accounts often title a track "Artist - Title".
        if (rt.indexOf(targetArtist) === 0 && rt !== targetArtist) rt = rt.slice(targetArtist.length);
        if ((ra === targetArtist || sameCredit(results[i].artist)) && rt === targetTitle && !isVariant(results[i]))
          candidates.push(results[i]);
      }
    }
    for (i = 0; i < results.length; i++) {
      if (candidates.indexOf(results[i]) === -1 && !isVariant(results[i]) && matches(results[i]))
        candidates.push(results[i]);
    }
    // Nothing the gate would accept (and, on an engine without property escapes,
    // any non-Latin name): the results that are not another version, and the
    // confidence gate decides.
    if (candidates.length === 0) {
      for (i = 0; i < results.length; i++) {
        if (!isVariant(results[i])) candidates.push(results[i]);
      }
    }
    // Only a track that streams is a source. An artist can make a track
    // buy-only (Radiohead's own "Nude" and "Reckoner" on Bandcamp), and it
    // would show a Bandcamp icon and fail when played. So the pick is checked,
    // and if it's buy-only the track gets no Bandcamp source at all: we never
    // go looking for another Bandcamp copy of the same song. The next match
    // down is almost always someone else's upload (Radiohead's "Nude" has a
    // "stripped mix" credited to Radiohead on another account), not the
    // artist's recording. A check that failed keeps the pick (playback still
    // falls back), and so does one too late to check: the whole resolve has
    // RESOLVE_BUDGET_MS (8s, resolver-limiter.js), and each check gives up
    // after 2s.
    var CHECK_DEADLINE_MS = 5000;
    var pick = candidates[0];
    if (!pick) return null;
    if (typeof this.isStreamable !== 'function' || !pick.bandcampBandId || !pick.bandcampTrackId) return pick;
    if (Date.now() - startedAt > CHECK_DEADLINE_MS) return pick;
    var streams = await this.isStreamable(pick.bandcampBandId, pick.bandcampTrackId, pick.bandcampUrl);
    if (streams !== false) return pick;
    return null;
  },
  // Whether Bandcamp lets this track stream: true, false (the artist made it
  // buy-only), or null when the check itself failed (a network or HTTP error,
  // a reply of an unexpected shape, or no answer within 2s). One request to
  // Bandcamp's mobile API, which lists a streamable track with its
  // streaming_url and a buy-only one with no tracks, or a track without one.
  // Answers are kept for the session by track id (and by page, for
  // sourceFromUrl), so a track is checked once; a failed check is not kept.
  isStreamable: async function (bandId, trackId, url) {
    if (!bandId || !trackId) return null;
    var key = String(trackId);
    var known = this._bandcampStreams && this._bandcampStreams.byId[key];
    if (typeof known === 'boolean') {
      if (typeof this.noteStreamable === 'function') this.noteStreamable(key, url, known);
      return known;
    }
    if (!this._bandcampPending) this._bandcampPending = Object.create(null);
    var pending = this._bandcampPending;
    if (!pending[key]) {
      var ask = (async function () {
        try {
          var resp = await fetch(
            'https://bandcamp.com/api/mobile/24/tralbum_details?band_id=' +
              encodeURIComponent(bandId) +
              '&tralbum_type=t&tralbum_id=' +
              encodeURIComponent(key),
          );
          if (!resp || !resp.ok) return null;
          var data = await resp.json();
          if (!data || typeof data !== 'object' || !Array.isArray(data.tracks)) return null;
          if (data.tracks.length === 0) return false;
          var t = null;
          for (var n = 0; n < data.tracks.length; n++) {
            if (data.tracks[n] && String(data.tracks[n].track_id) === key) t = data.tracks[n];
          }
          if (!t) t = data.tracks[0];
          if (!t || typeof t !== 'object') return null;
          var su = t.streaming_url;
          return !!(su && typeof su === 'object' && Object.keys(su).length > 0);
        } catch (e) {
          return null;
        }
      })();
      var timer = null;
      var giveUp = new Promise(function (resolve) {
        if (typeof setTimeout === 'function') {
          timer = setTimeout(function () {
            resolve(null);
          }, 2000);
        }
      });
      pending[key] = Promise.race([ask, giveUp]).then(function (answer) {
        if (timer !== null && typeof clearTimeout === 'function') clearTimeout(timer);
        delete pending[key];
        return answer;
      });
    }
    var answer = await pending[key];
    if (answer !== null && typeof this.noteStreamable === 'function') this.noteStreamable(key, url, answer);
    return answer;
  },
  // Keeps a streaming answer for the session, by track id and by track page
  // (isStreamable, and the album and track pages, which carry it for free).
  noteStreamable: function (trackId, url, streams) {
    if (typeof streams !== 'boolean') return;
    if (!this._bandcampStreams) this._bandcampStreams = { byId: Object.create(null), byUrl: Object.create(null) };
    if (trackId) this._bandcampStreams.byId[String(trackId)] = streams;
    if (url) this._bandcampStreams.byUrl[url] = streams;
  },
  // A source for a track that already knows its Bandcamp track page (one
  // scraped from a playlist page keeps it), built from the link without a
  // fetch or a search. The app asks this during resolution when the
  // registry routes the track's link here as a track link
  // (src/renderer/lib/source-url-hint.js); track is { title, artist, album,
  // duration } from the app's track. A page already known not to stream
  // this session gives none (null: the app falls back to resolve, which
  // checks what it finds).
  sourceFromUrl: function (url, track) {
    if (this._bandcampStreams && this._bandcampStreams.byUrl[url] === false) return null;
    return {
      id: 'bandcamp-' + Date.now(),
      title: track.title,
      artist: track.artist,
      album: track.album || '',
      duration: track.duration > 0 ? track.duration : null,
      sources: ['bandcamp'],
      bandcampUrl: url,
      purchaseUrl: url,
    };
  },
  lookupUrl: async function (url, config) {
    try {
      console.log('Bandcamp URL lookup:', url);
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
      });
      if (!response.ok) return null;
      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      // Whether the track streams, from the page's own player data (no
      // extra request): data-tralbum's trackinfo carries the audio file, and
      // a buy-only track's has none. A buy-only track comes back without a
      // Bandcamp source (it plays from another service, or shows as
      // unavailable); unreadable player data is unknown and keeps the source.
      let streams = null;
      try {
        const el = doc.querySelector('[data-tralbum]');
        const raw = el && el.getAttribute ? el.getAttribute('data-tralbum') : null;
        const tralbum = raw ? JSON.parse(raw) : null;
        const info =
          tralbum && tralbum.item_type !== 'album' && Array.isArray(tralbum.trackinfo) ? tralbum.trackinfo[0] : null;
        if (info && typeof info === 'object' && 'file' in info) {
          streams = !!(info.file && typeof info.file === 'object' && Object.keys(info.file).length > 0);
          if (typeof this.noteStreamable === 'function') this.noteStreamable(info.track_id || info.id, url, streams);
        }
      } catch (e) {}
      const withSource = (t) =>
        streams === false
          ? Object.assign(t, { sources: [], purchaseUrl: url, streamable: false })
          : Object.assign(t, { sources: ['bandcamp'], bandcampUrl: url, purchaseUrl: url });
      const ldScripts = doc.querySelectorAll('script[type="application/ld+json"]');
      for (const ldEl of ldScripts) {
        try {
          const ld = JSON.parse(ldEl.textContent);
          if (ld['@type'] === 'MusicRecording') {
            let duration = 0;
            if (ld.duration) {
              const m = ld.duration.match(/P(?:\d+H)?(\d+)M(\d+)S/);
              if (m) duration = parseInt(m[1]) * 60 + parseInt(m[2]);
            }
            const artist =
              ld.byArtist?.name ||
              doc.querySelector('meta[property="og:site_name"]')?.content ||
              '';
            const album = ld.inAlbum?.name || '';
            const albumArt =
              doc.querySelector('meta[property="og:image"]')?.content || ld.image || '';
            return withSource({
              id: `bandcamp-${Date.now()}`,
              title: ld.name,
              artist: artist,
              album: album,
              duration: duration > 0 ? duration : null,
              albumArt: albumArt,
            });
          }
        } catch (e) {}
      }
      const title = doc.querySelector('meta[property="og:title"]')?.content;
      const artist = doc.querySelector('meta[property="og:site_name"]')?.content;
      const albumArt = doc.querySelector('meta[property="og:image"]')?.content;
      if (!title || !artist) return null;
      return withSource({
        id: `bandcamp-${Date.now()}`,
        title: title,
        artist: artist,
        album: '',
        duration: null,
        albumArt: albumArt,
      });
    } catch (error) {
      console.error('Bandcamp URL lookup error:', error);
      return null;
    }
  },
  // Album search for the catalog fallback (docs/architecture/plugins.md,
  // "searchAlbums"). The same two public endpoints as search, filtered to
  // albums ('a'). Each result's url is the album page, which lookupAlbum
  // below reads.
  searchAlbums: async function (query, config) {
    var term =
      typeof query === 'string'
        ? query
        : [query && query.artist, query && query.title].filter(Boolean).join(' ');
    term = (term || '').trim();
    if (term.length < 2) return [];
    var normalizeUrl = function (u) {
      if (typeof u !== 'string' || !u) return null;
      // app_autocomplete returns a doubled url; keep the last absolute URL.
      var i = u.lastIndexOf('https://');
      return i > 0 ? u.slice(i) : u;
    };
    // Cover art for a search result. The search API's img field names the
    // image without the "a" prefix album art lives under, so it 404s at every
    // size (img/2732951243_3.jpg); img/a<art_id>_10.jpg is the 1200px cover.
    // Each exported function is serialized on its own, so this is repeated
    // in search and searchAlbums.
    var bandcampArtUrl = function (r) {
      if (r && r.art_id) return 'https://f4.bcbits.com/img/a' + r.art_id + '_10.jpg';
      return r && r.img ? r.img.replace('_3.jpg', '_10.jpg') : null;
    };
    var toAlbum = function (r) {
      if (!r || !r.name) return null;
      var url = normalizeUrl(r.item_url_path || r.url);
      if (!url || url.indexOf('/album/') === -1) return null;
      return {
        id: 'bandcamp-album-' + (r.id || url),
        name: r.name,
        artist: r.band_name || '',
        albumArt: bandcampArtUrl(r),
        releaseDate: null,
        trackCount: null,
        url: url,
      };
    };
    try {
      var items = [];
      try {
        var resp = await fetch('https://bandcamp.com/api/bcsearch_public_api/1/autocomplete_elastic', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            search_text: term,
            search_filter: 'a',
            full_page: false,
            fan_id: null,
          }),
        });
        if (resp.ok) {
          var data = await resp.json();
          items = (data && data.auto && data.auto.results) || [];
        }
      } catch (e) {
        console.warn('Bandcamp album search API error:', e && e.message);
      }
      if (items.length === 0) {
        try {
          var resp2 = await fetch(
            'https://bandcamp.com/api/fuzzysearch/1/app_autocomplete?q=' + encodeURIComponent(term),
          );
          if (resp2.ok) {
            var data2 = await resp2.json();
            items = ((data2 && data2.results) || []).filter(function (x) {
              return x && x.type === 'a';
            });
          }
        } catch (e2) {
          console.warn('Bandcamp album autocomplete error:', e2 && e2.message);
        }
      }
      var albums = [];
      for (var j = 0; j < items.length && albums.length < 10; j++) {
        if (items[j] && items[j].type && items[j].type !== 'a') continue;
        var a = toAlbum(items[j]);
        if (a) albums.push(a);
      }
      return albums;
    } catch (error) {
      console.error('Bandcamp album search error:', error);
      return [];
    }
  },
  lookupAlbum: async function (url, config) {
    try {
      console.log('Bandcamp album lookup:', url);
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
      });
      if (!response.ok) return null;
      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const albumArt = doc.querySelector('meta[property="og:image"]')?.content || '';
      // Which tracks stream, from the page's own player data (no extra
      // request): each of data-tralbum's trackinfo entries carries its audio
      // file, and a buy-only track's has none. Every track stays in the list
      // (an album page shows them all), but a buy-only one carries no
      // Bandcamp source: it plays from another service or shows as
      // unavailable. Unreadable player data is unknown and keeps every source.
      const streamsByPath = {};
      let trackinfo = [];
      try {
        const el = doc.querySelector('[data-tralbum]');
        const raw = el && el.getAttribute ? el.getAttribute('data-tralbum') : null;
        const tralbum = raw ? JSON.parse(raw) : null;
        if (tralbum && Array.isArray(tralbum.trackinfo)) trackinfo = tralbum.trackinfo;
      } catch (e) {}
      const pagePath = (u) => (typeof u === 'string' ? u.replace(/^https?:\/\/[^/]+/i, '').split('?')[0] : '');
      const fileStreams = (info) =>
        info && typeof info === 'object' && 'file' in info
          ? !!(info.file && typeof info.file === 'object' && Object.keys(info.file).length > 0)
          : null;
      for (const info of trackinfo) {
        if (info && info.title_link) streamsByPath[pagePath(info.title_link)] = fileStreams(info);
      }
      const streamsFor = (trackUrl, i) => {
        const byPath = streamsByPath[pagePath(trackUrl)];
        if (typeof byPath === 'boolean') return byPath;
        return trackinfo.length > 0 && trackinfo[i] ? fileStreams(trackinfo[i]) : null;
      };
      let albumName = '';
      let artist = '';
      let tracks = [];
      let releaseDate = null;
      const ldScripts = doc.querySelectorAll('script[type="application/ld+json"]');
      for (const ldEl of ldScripts) {
        try {
          const ld = JSON.parse(ldEl.textContent);
          if (ld['@type'] === 'MusicAlbum' && ld.track) {
            albumName = ld.name || '';
            artist = ld.byArtist?.name || '';
            // datePublished reads "19 Feb 2008 00:00:00 GMT": a UTC midnight,
            // so the ISO date's first ten characters are the calendar day.
            // The album page's edition picker shows it (#1312).
            const published = Date.parse(ld.datePublished || '');
            if (Number.isFinite(published)) releaseDate = new Date(published).toISOString().slice(0, 10);
            const items = ld.track.itemListElement || [];
            tracks = items.map((item, i) => {
              const t = item.item || item;
              let duration = 0;
              if (t.duration) {
                const m = t.duration.match(/P(?:\d+H)?(\d+)M(\d+)S/);
                if (m) duration = parseInt(m[1]) * 60 + parseInt(m[2]);
              }
              const trackUrl = t['@id'] || t.mainEntityOfPage || url;
              const streams = streamsFor(trackUrl, i);
              if (typeof streams === 'boolean' && typeof this.noteStreamable === 'function') {
                const info = trackinfo.find((x) => x && pagePath(x.title_link) === pagePath(trackUrl)) || trackinfo[i];
                this.noteStreamable(info && (info.track_id || info.id), trackUrl, streams);
              }
              const entry = {
                id: `bandcamp-${Date.now()}-${i}`,
                title: t.name,
                artist: artist,
                album: albumName,
                duration: duration,
                sources: ['bandcamp'],
                bandcampUrl: trackUrl,
                purchaseUrl: trackUrl,
                trackNumber: item.position || i + 1,
              };
              if (streams === false) {
                entry.sources = [];
                delete entry.bandcampUrl;
                entry.streamable = false;
              }
              return entry;
            });
            break;
          }
        } catch (e) {}
      }
      if (!albumName) albumName = doc.querySelector('meta[property="og:title"]')?.content || '';
      if (!artist) artist = doc.querySelector('meta[property="og:site_name"]')?.content || '';
      if (tracks.length === 0) return null;
      return {
        id: `bandcamp-album-${Date.now()}`,
        name: albumName,
        artist: artist,
        albumArt: albumArt,
        releaseDate: releaseDate,
        trackCount: tracks.length,
        tracks: tracks,
        url: url,
      };
    } catch (error) {
      console.error('Bandcamp album lookup error:', error);
      return null;
    }
  },
  play: async function (track, config) {
    if (!track.bandcampUrl) {
      console.error('No Bandcamp URL found');
      return false;
    }
    try {
      if (window.electron?.shell?.openExternal) {
        const result = await window.electron.shell.openExternal(track.bandcampUrl);
        return result && result.success;
      } else {
        const newWindow = window.open(track.bandcampUrl, '_blank');
        return !!newWindow;
      }
    } catch (error) {
      console.error('Failed to open Bandcamp link:', error);
      return false;
    }
  },
  init: async function (config) {
    console.log('Bandcamp resolver initialized');
  },
  cleanup: async function () {
    console.log('Bandcamp resolver cleanup');
  },
};
