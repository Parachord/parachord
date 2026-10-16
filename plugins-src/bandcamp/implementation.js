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
    var toResult = function (r) {
      if (!r || !r.name) return null;
      var url = normalizeUrl(r.item_url_path || r.url);
      if (!url) return null;
      return {
        id: 'bandcamp-' + (r.id || url),
        title: r.name,
        artist: r.band_name || 'Unknown Artist',
        album: r.album_name || 'Single',
        duration: 210,
        sources: ['bandcamp'],
        bandcampUrl: url,
        purchaseUrl: url,
        bandcampTrackId: r.id || null,
        bandcampAlbumId: r.album_id || null,
        albumArt: r.img ? r.img.replace('_3.jpg', '_10.jpg') : null,
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
    // Prefer the first result that passes an artist+title containment check (the
    // same shape as validateResolvedTrack in confidence-scoring.js), so the
    // downstream 0.6 confidence floor doesn't drop a correct match that isn't
    // ranked first. This is only a ranking hint - the platform-native confidence
    // gate is still authoritative - so it uses engine-portable ASCII normalization
    // (no Unicode property-escape regex, guarded String.normalize) because this .axe also runs in the
    // mobile JS runtime. Non-Latin names normalize to '' and just fall through to
    // the top result.
    var norm = function (s) {
      s = (s || '').toString().toLowerCase();
      if (typeof s.normalize === 'function') s = s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
      return s.replace(/[^a-z0-9]/g, '');
    };
    var contains = function (a, b) {
      return !!a && !!b && (a.indexOf(b) !== -1 || b.indexOf(a) !== -1);
    };
    var targetArtist = norm(artist);
    var targetTitle = norm(track);
    var results = await this.search(((artist || '') + ' ' + (track || '')).trim(), config);
    if (results.length === 0) return null;
    for (var i = 0; i < results.length; i++) {
      if (
        contains(norm(results[i].artist), targetArtist) &&
        contains(norm(results[i].title), targetTitle)
      )
        return results[i];
    }
    return results[0];
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
