// Source of truth for plugins/bandcamp.axe v1.1.0.
// Imported from the .axe by `node scripts/build-axes.js --import`.
// Edit here, bump manifest.version in manifest.json, then run `node scripts/build-axes.js`.
// The functions materialize fully isolated (resolver-loader.js uses
// new Function) — no shared scope between them; helpers must be embedded per function.
module.exports = {
  search: async function (query, config) {
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
        duration: 210,
        sources: ['bandcamp'],
        bandcampUrl: url,
        purchaseUrl: url,
        bandcampTrackId: r.id || null,
        bandcampAlbumId: r.album_id || null,
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
      for (var i = 0; i < items.length && results.length < 20; i++) {
        var t = toResult(items[i]);
        if (t) results.push(t);
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
      /\b(live|remix(es|ed)?|rmx|cover(s|ed)?|covering|tribute|karaoke|instrumental|acoustic|demo|unplugged|rework|bootleg|mashup|reprise|edit|jam track|sped up|slowed|in the style of)\b/gi;
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
    var targetArtist = norm(stripFeat(artist));
    var targetTitle = norm(stripFeat(track));
    var isVariant = function (r) {
      return hasVariant(r.title, track) || hasVariant(r.artist, artist);
    };
    var results = await this.search(((artist || '') + ' ' + (track || '')).trim(), config);
    if (results.length === 0) return null;
    var i;
    if (targetArtist && targetTitle) {
      for (i = 0; i < results.length; i++) {
        var ra = norm(stripFeat(results[i].artist));
        var rt = norm(stripFeat(results[i].title));
        // Label accounts often title a track "Artist - Title".
        if (rt.indexOf(targetArtist) === 0 && rt !== targetArtist) rt = rt.slice(targetArtist.length);
        if ((ra === targetArtist || sameCredit(results[i].artist)) && rt === targetTitle && !isVariant(results[i]))
          return results[i];
      }
    }
    for (i = 0; i < results.length; i++) {
      if (!isVariant(results[i]) && matches(results[i])) return results[i];
    }
    // Nothing the gate would accept (and, on an engine without property escapes,
    // any non-Latin name): hand back the top result that is not another version
    // and let the confidence gate decide.
    for (i = 0; i < results.length; i++) {
      if (!isVariant(results[i])) return results[i];
    }
    return null;
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
            return {
              id: `bandcamp-${Date.now()}`,
              title: ld.name,
              artist: artist,
              album: album,
              duration: duration,
              sources: ['bandcamp'],
              bandcampUrl: url,
              purchaseUrl: url,
              albumArt: albumArt,
            };
          }
        } catch (e) {}
      }
      const title = doc.querySelector('meta[property="og:title"]')?.content;
      const artist = doc.querySelector('meta[property="og:site_name"]')?.content;
      const albumArt = doc.querySelector('meta[property="og:image"]')?.content;
      if (!title || !artist) return null;
      return {
        id: `bandcamp-${Date.now()}`,
        title: title,
        artist: artist,
        album: '',
        duration: 0,
        sources: ['bandcamp'],
        bandcampUrl: url,
        purchaseUrl: url,
        albumArt: albumArt,
      };
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
      let albumName = '';
      let artist = '';
      let tracks = [];
      const ldScripts = doc.querySelectorAll('script[type="application/ld+json"]');
      for (const ldEl of ldScripts) {
        try {
          const ld = JSON.parse(ldEl.textContent);
          if (ld['@type'] === 'MusicAlbum' && ld.track) {
            albumName = ld.name || '';
            artist = ld.byArtist?.name || '';
            const items = ld.track.itemListElement || [];
            tracks = items.map((item, i) => {
              const t = item.item || item;
              let duration = 0;
              if (t.duration) {
                const m = t.duration.match(/P(?:\d+H)?(\d+)M(\d+)S/);
                if (m) duration = parseInt(m[1]) * 60 + parseInt(m[2]);
              }
              const trackUrl = t['@id'] || t.mainEntityOfPage || url;
              return {
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
