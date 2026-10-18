// Source of truth for plugins/plex.axe.
// Edit here, bump manifest.version in manifest.json, then run `node scripts/build-axes.js`.
//
// Plex Media Server resolver, contributed by JP Hastings-Edrei (parachord#926).
// Sign-in is Plex's PIN OAuth; servers and libraries come from plex.tv's
// resources API; search/resolve run against a per-library index built in the
// background (window._plexIndex) with a live /hubs/search fallback; playback
// is a direct HTTP(S) stream URL into the app's shared HTML5 audio element.
//
// Every request goes through window.electron.plex.fetch, a main-process
// handler scoped to plex.tv, *.plex.direct and the connection hosts saved in
// this plugin's config (main-process/ipc/plex-fetch.js). Renderer fetch is
// blocked by CORS and the general proxy-fetch refuses LAN addresses.
//
// Tracks never carry the server access token: _mapTrack keeps only
// plexServerId / plexRatingKey / plexPartKey, and play()/getStreamUrl()
// resolve the token and connections from the saved config. Tracks are
// persisted into the saved queue and playlists, so a token on the track would
// be written to disk a second time. (Album-art URLs still embed the token:
// Plex thumbs cannot be fetched without one.)
//
// The functions materialize fully isolated (resolver-loader.js uses
// new Function) but are installed as methods of one object, so `this.x` works.
module.exports = {
  _fetch: async function (url, options) {
    options = options || {};
    if (window.electron && window.electron.plex && window.electron.plex.fetch) {
      var res = await window.electron.plex.fetch(url, options);
      return {
        ok: !!res.ok,
        status: res.status || 0,
        error: res.error || null,
        json: function () {
          return new Promise(function (resolve, reject) {
            try { resolve(JSON.parse(res.text || 'null')); } catch (e) { reject(e); }
          });
        },
        text: function () { return Promise.resolve(res.text || ''); }
      };
    }
    return fetch(url, options);
  },

  // First reachable connection for a server, probed concurrently and cached
  // for five minutes.
  _baseUrl: async function (server) {
    if (!server) return null;
    if (!window._plexBaseCache) window._plexBaseCache = {};
    var cached = window._plexBaseCache[server.serverId];
    if (cached && (Date.now() - cached.ts) < 300000) return cached.baseUrl;
    var conns = (server.connections || []).map(function (c) { return String(c).replace(/\/$/, ''); });
    if (!conns.length) return null;
    var self = this;
    var probe = function (base) {
      return self._fetch(base + '/identity?X-Plex-Token=' + encodeURIComponent(server.accessToken), {
        headers: { 'Accept': 'application/json' },
        timeoutMs: 6000
      }).then(function (r) { return (r && r.ok) ? base : null; }).catch(function () { return null; });
    };
    var results = await Promise.all(conns.map(probe));
    for (var i = 0; i < results.length; i++) {
      if (results[i]) {
        window._plexBaseCache[server.serverId] = { baseUrl: results[i], ts: Date.now() };
        return results[i];
      }
    }
    return null;
  },

  // Plex metadata → the app's track shape. No token, no connection list on
  // the track (see the header); ISRC normalised and validated at capture so
  // the resolver is the source of truth for it.
  _mapTrack: function (t, server, baseUrl) {
    var partKey = null;
    if (t.Media && t.Media[0] && t.Media[0].Part && t.Media[0].Part[0]) {
      partKey = t.Media[0].Part[0].key;
    }
    var albumArt = t.thumb ? baseUrl + t.thumb + '?X-Plex-Token=' + encodeURIComponent(server.accessToken) : null;
    // Correlation IDs. Plex's `guid` (plex://track/...) is a stable catalogue
    // identifier; the `Guid` array (populated with includeGuids=1) carries
    // MusicBrainz / ISRC external IDs when the library matched via the Plex
    // Music agent. These feed the app's ISRC/MBID enrichment pipeline.
    var mbid = null, isrc = null;
    var guidList = t.Guid || [];
    for (var gi = 0; gi < guidList.length; gi++) {
      var gid = (guidList[gi] && guidList[gi].id) ? String(guidList[gi].id) : '';
      if (gid.indexOf('mbid://') === 0) mbid = gid.slice(7);
      else if (gid.indexOf('isrc://') === 0) isrc = gid.slice(7);
    }
    if (isrc) {
      isrc = String(isrc).trim().toUpperCase();
      if (!/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(isrc)) isrc = null;
    }
    var out = {
      id: 'plex-' + server.serverId + '-' + t.ratingKey,
      title: t.title || '',
      artist: t.grandparentTitle || t.originalTitle || 'Unknown Artist',
      album: t.parentTitle || '',
      duration: Math.floor((t.duration || 0) / 1000),
      sources: ['plex'],
      plexRatingKey: t.ratingKey,
      plexServerId: server.serverId,
      plexServerName: server.serverName,
      plexPartKey: partKey,
      trackNumber: t.index || 0,
      albumArt: albumArt,
      plexGuid: t.guid || null,
      plexAlbumGuid: t.parentGuid || null,
      plexArtistGuid: t.grandparentGuid || null
    };
    if (mbid) { out.mbid = mbid; out.recordingMbid = mbid; }
    if (isrc) out.isrc = isrc;
    return out;
  },

  // Server record (token + connections) for a server id, from the saved
  // library selection first, then from a live discovery.
  _serverFor: async function (serverId, config) {
    if (config && config.libraries) {
      var lib = config.libraries.find(function (l) { return l.serverId === serverId; });
      if (lib) {
        return { serverId: serverId, serverName: lib.serverName, accessToken: lib.accessToken, connections: lib.connections };
      }
    }
    if (config && config.authToken) {
      var disc = await this.discoverLibraries(config);
      var srv = (disc.servers || []).find(function (s) { return s.serverId === serverId; });
      if (srv) return srv;
    }
    return null;
  },

  _indexKey: function (serverId, libKey) { return serverId + '::' + libKey; },

  _allIndexed: function (config) {
    if (!config || !config.libraries || !config.libraries.length) return false;
    if (!window._plexIndex) return false;
    var self = this;
    return config.libraries.every(function (l) {
      var e = window._plexIndex[self._indexKey(l.serverId, l.key)];
      return e && e.status === 'ready';
    });
  },

  // Kick off (idempotent) background index builds for every selected library.
  buildIndex: function (config) {
    if (!config || !config.libraries || !config.libraries.length) return;
    if (!window._plexIndex) window._plexIndex = {};
    var self = this;
    var byServer = {};
    config.libraries.forEach(function (l) {
      if (!byServer[l.serverId]) byServer[l.serverId] = { serverId: l.serverId, serverName: l.serverName, accessToken: l.accessToken, connections: l.connections, libs: [] };
      byServer[l.serverId].libs.push({ key: l.key, title: l.title });
    });
    Object.keys(byServer).forEach(function (sid) {
      var server = byServer[sid];
      server.libs.forEach(function (lib) { self._buildLibraryIndex(server, lib.key, lib.title); });
    });
  },

  // Drop the in-memory index and connection cache (sign-out, or the resolver
  // being unloaded). The next buildIndex starts from scratch.
  clearIndex: function () {
    try { delete window._plexIndex; } catch (e) { window._plexIndex = undefined; }
    try { delete window._plexBaseCache; } catch (e) { window._plexBaseCache = undefined; }
  },

  _buildLibraryIndex: async function (server, libKey, libTitle) {
    if (!window._plexIndex) window._plexIndex = {};
    var key = this._indexKey(server.serverId, libKey);
    var existing = window._plexIndex[key];
    if (existing && (existing.status === 'building' || (existing.status === 'ready' && (Date.now() - existing.ts) < 3600000))) {
      return; // already building, or fresh within the last hour
    }
    var entry = {
      status: 'building', scanned: 0, total: 0,
      serverId: server.serverId, serverName: server.serverName,
      libraryKey: libKey, libraryTitle: libTitle,
      byMbid: {}, byIsrc: {}, byTitle: {}, ts: Date.now(), error: null
    };
    window._plexIndex[key] = entry;
    var stripFeat = function (s) { return (s || '').replace(/[([]\s*(feat|ft|featuring|with)\b[^)\]]*[)\]]/ig, '').replace(/\s{2,}/g, ' ').trim(); };
    var norm = function (s) { return (s || '').toString().toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]/gu, ''); };
    try {
      var base = await this._baseUrl(server);
      if (!base) { entry.status = 'error'; entry.error = 'Server unreachable'; return; }
      var tok = encodeURIComponent(server.accessToken);
      var pageSize = 1000, start = 0;
      while (true) {
        var url = base + '/library/sections/' + libKey + '/all?type=10&includeGuids=1&X-Plex-Container-Start=' + start + '&X-Plex-Container-Size=' + pageSize + '&X-Plex-Token=' + tok;
        var resp = await this._fetch(url, { headers: { 'Accept': 'application/json' }, timeoutMs: 30000 });
        if (!resp.ok) { entry.status = 'error'; entry.error = 'HTTP ' + resp.status; return; }
        var data = await resp.json();
        var c = data.MediaContainer || {};
        var meta = c.Metadata || [];
        entry.total = c.totalSize || c.size || (start + meta.length);
        for (var i = 0; i < meta.length; i++) {
          var trk = this._mapTrack(meta[i], server, base);
          if (trk.mbid) entry.byMbid[trk.mbid] = trk;
          if (trk.isrc) entry.byIsrc[trk.isrc] = trk;
          var tk = {};
          tk[norm(trk.title)] = 1;
          tk[norm(stripFeat(trk.title))] = 1;
          for (var nk in tk) { if (nk) { (entry.byTitle[nk] = entry.byTitle[nk] || []).push(trk); } }
        }
        entry.scanned += meta.length;
        start += pageSize;
        if (meta.length < pageSize || (entry.total && entry.scanned >= entry.total)) break;
      }
      entry.status = 'ready';
      entry.ts = Date.now();
      console.log('Plex index ready:', libTitle, '—', entry.scanned, 'tracks (' + Object.keys(entry.byMbid).length + ' MBID, ' + Object.keys(entry.byIsrc).length + ' ISRC)');
    } catch (e) {
      entry.status = 'error';
      entry.error = e.message;
      console.error('Plex index build failed for', libTitle, e);
    }
  },

  indexStatus: function (config) {
    var self = this;
    if (!config || !config.libraries) return [];
    return config.libraries.map(function (l) {
      var e = (window._plexIndex || {})[self._indexKey(l.serverId, l.key)];
      return {
        serverName: l.serverName,
        libraryTitle: l.title,
        status: e ? e.status : 'pending',
        scanned: e ? e.scanned : 0,
        total: e ? e.total : 0,
        error: e ? e.error : null
      };
    });
  },

  _indexCandidatesByTitle: function (config, nTitleClean, nTitleFull) {
    var self = this;
    var out = [], seen = {};
    config.libraries.forEach(function (l) {
      var e = (window._plexIndex || {})[self._indexKey(l.serverId, l.key)];
      if (!e || e.status !== 'ready') return;
      [nTitleClean, nTitleFull].forEach(function (k) {
        if (!k) return;
        var arr = e.byTitle[k];
        if (arr) arr.forEach(function (t) { if (!seen[t.id]) { seen[t.id] = 1; out.push(t); } });
      });
    });
    return out;
  },

  _searchIndex: function (config, query) {
    var self = this;
    var norm = function (s) { return (s || '').toString().toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]/gu, ''); };
    var nq = norm(query);
    if (!nq) return [];
    var out = [], seen = {};
    config.libraries.forEach(function (l) {
      var e = (window._plexIndex || {})[self._indexKey(l.serverId, l.key)];
      if (!e || e.status !== 'ready') return;
      for (var titleKey in e.byTitle) {
        if (titleKey && titleKey.length >= 3 && nq.indexOf(titleKey) !== -1) {
          e.byTitle[titleKey].forEach(function (t) { if (!seen[t.id]) { seen[t.id] = 1; out.push(t); } });
        }
      }
    });
    return out;
  },

  // PIN OAuth: create a PIN, open plex.tv's sign-in in the browser, poll the
  // PIN until it carries an auth token (two minutes), then read the username.
  connect: async function (config) {
    try {
      var clientId = (config && config.clientId);
      if (!clientId) {
        var tmpl = 'xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx';
        var out = '';
        for (var i = 0; i < tmpl.length; i++) {
          var ch = tmpl[i];
          if (ch === 'x') out += Math.floor(Math.random() * 16).toString(16);
          else if (ch === 'y') out += (8 + Math.floor(Math.random() * 4)).toString(16);
          else out += ch;
        }
        clientId = 'parachord-' + out;
      }
      var product = 'Parachord';
      var headers = {
        'Accept': 'application/json',
        'X-Plex-Product': product,
        'X-Plex-Version': '1.0.0',
        'X-Plex-Client-Identifier': clientId,
        'X-Plex-Device': 'Parachord',
        'X-Plex-Platform': 'Web'
      };
      var pinResp = await this._fetch('https://plex.tv/api/v2/pins?strong=true', { method: 'POST', headers: headers });
      if (!pinResp.ok) return { success: false, error: 'Could not start Plex sign-in (HTTP ' + pinResp.status + ')' };
      var pin = await pinResp.json();
      var authUrl = 'https://app.plex.tv/auth#?clientID=' + encodeURIComponent(clientId) +
        '&code=' + encodeURIComponent(pin.code) +
        '&context%5Bdevice%5D%5Bproduct%5D=' + encodeURIComponent(product);
      if (window.electron && window.electron.shell && window.electron.shell.openExternal) {
        window.electron.shell.openExternal(authUrl);
      } else {
        window.open(authUrl, '_blank');
      }
      var deadline = Date.now() + 120000;
      while (Date.now() < deadline) {
        await new Promise(function (r) { setTimeout(r, 2000); });
        var chk = await this._fetch('https://plex.tv/api/v2/pins/' + pin.id, {
          headers: { 'Accept': 'application/json', 'X-Plex-Client-Identifier': clientId }
        });
        if (!chk.ok) continue;
        var pd = await chk.json();
        if (pd && pd.authToken) {
          var username = '';
          try {
            var uResp = await this._fetch('https://plex.tv/api/v2/user', {
              headers: { 'Accept': 'application/json', 'X-Plex-Token': pd.authToken, 'X-Plex-Client-Identifier': clientId }
            });
            if (uResp.ok) {
              var u = await uResp.json();
              username = u.username || u.title || u.friendlyName || u.email || '';
            }
          } catch (e) { /* username is cosmetic */ }
          return { success: true, authToken: pd.authToken, clientId: clientId, username: username };
        }
      }
      return { success: false, error: 'Timed out waiting for Plex sign-in. Please try again.' };
    } catch (e) {
      return { success: false, error: e.message };
    }
  },

  // Every server on the account with its music ("artist" type) libraries.
  // Connections are ordered local first, https preferred, relay last.
  discoverLibraries: async function (config) {
    try {
      if (!config || !config.authToken) return { error: 'Not signed in to Plex', servers: [] };
      var clientId = config.clientId || 'parachord';
      var resResp = await this._fetch('https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1', {
        headers: { 'Accept': 'application/json', 'X-Plex-Token': config.authToken, 'X-Plex-Client-Identifier': clientId }
      });
      if (!resResp.ok) return { error: 'Could not list Plex servers (HTTP ' + resResp.status + ')', servers: [] };
      var resources = await resResp.json();
      var self = this;
      var serverResources = (resources || []).filter(function (r) {
        return r.provides && r.provides.indexOf('server') !== -1;
      });
      // Probe every server concurrently so discovery is fast even with several.
      var servers = await Promise.all(serverResources.map(async function (r) {
        var conns = (r.connections || []).slice().sort(function (a, b) {
          var score = function (c) { var s = 0; if (c.local) s -= 2; if (c.protocol === 'https') s -= 1; if (c.relay) s += 3; return s; };
          return score(a) - score(b);
        }).map(function (c) { return c.uri; }).filter(Boolean);
        var server = {
          serverId: r.clientIdentifier,
          serverName: r.name,
          owned: !!r.owned,
          accessToken: r.accessToken,
          connections: conns,
          libraries: [],
          reachable: false
        };
        var base = await self._baseUrl(server);
        if (base) {
          server.reachable = true;
          try {
            var secResp = await self._fetch(base + '/library/sections?X-Plex-Token=' + encodeURIComponent(server.accessToken), {
              headers: { 'Accept': 'application/json' }
            });
            if (secResp.ok) {
              var secData = await secResp.json();
              var dirs = (secData.MediaContainer && secData.MediaContainer.Directory) || [];
              for (var j = 0; j < dirs.length; j++) {
                if (dirs[j].type === 'artist') {
                  server.libraries.push({ key: String(dirs[j].key), title: dirs[j].title });
                }
              }
            }
          } catch (e) { /* reachable but section listing failed */ }
        }
        return server;
      }));
      return { servers: servers };
    } catch (e) {
      return { error: e.message, servers: [] };
    }
  },

  search: async function (query, config) {
    var libs = (config && config.libraries) || [];
    if (!libs.length) return [];
    var self = this;
    // Fast path: serve from the local index when every library is ready.
    if (this._allIndexed(config)) {
      var idxResults = this._searchIndex(config, query);
      if (idxResults.length > 0) {
        var withId = idxResults.filter(function (r) { return r.mbid || r.isrc; }).length;
        console.log('Found ' + idxResults.length + ' Plex result(s) [indexed] — ' + withId + ' with MusicBrainz/ISRC');
      }
      return idxResults;
    }
    var byServer = {};
    for (var i = 0; i < libs.length; i++) {
      var l = libs[i];
      if (!byServer[l.serverId]) {
        byServer[l.serverId] = { serverId: l.serverId, serverName: l.serverName, accessToken: l.accessToken, connections: l.connections, keys: {} };
      }
      byServer[l.serverId].keys[String(l.key)] = true;
    }
    var ids = Object.keys(byServer);
    var results = [];
    for (var s = 0; s < ids.length; s++) {
      var server = byServer[ids[s]];
      var base = await self._baseUrl(server);
      if (!base) continue;
      try {
        var url = base + '/hubs/search?query=' + encodeURIComponent(query) + '&limit=50&includeGuids=1&X-Plex-Token=' + encodeURIComponent(server.accessToken);
        var resp = await self._fetch(url, { headers: { 'Accept': 'application/json' } });
        if (!resp.ok) { console.error('Plex search failed:', resp.status, 'on', server.serverName); continue; }
        var data = await resp.json();
        var container = data.MediaContainer;
        if (!container || !container.Hub) continue;
        for (var h = 0; h < container.Hub.length; h++) {
          var hub = container.Hub[h];
          if (hub.type !== 'track' || !hub.Metadata) continue;
          for (var m = 0; m < hub.Metadata.length; m++) {
            var t = hub.Metadata[m];
            if (t.librarySectionID != null && !server.keys[String(t.librarySectionID)]) continue;
            results.push(self._mapTrack(t, server, base));
          }
        }
      } catch (e) { console.error('Plex search error on', server.serverName, e); }
    }
    if (results.length > 0) {
      var withMb = results.filter(function (r) { return r.mbid || r.isrc; }).length;
      var withGuid = results.filter(function (r) { return r.plexGuid; }).length;
      console.log('Found ' + results.length + ' Plex result(s) — ' + withMb + ' with MusicBrainz/ISRC, ' + withGuid + ' with Plex guid');
    }
    return results;
  },

  resolve: async function (artist, track, album, config) {
    if (!config || !config.libraries || !config.libraries.length || !track) return null;
    var self = this;

    // Plex's search matches titles/names; feeding it the full credit list plus a
    // "(feat. ...)" suffix matches nothing. Search by the cleaned title, then
    // pick the result whose artist matches one of the credited artists.
    var stripFeat = function (s) {
      return (s || '')
        .replace(/[([]\s*(feat|ft|featuring|with)\b[^)\]]*[)\]]/ig, '')
        .replace(/\s*[-–—]\s*(feat|ft|featuring)\b.*$/ig, '')
        .replace(/\s+(feat|ft|featuring)\.?\s.*$/ig, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
    };
    var norm = function (s) {
      return (s || '').toString().toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]/gu, '');
    };
    var splitArtists = function (s) {
      return (s || '').split(/\s*[,;&/]\s*|\s+(?:feat|ft|featuring|with|x|vs)\.?\s+/i).map(function (a) { return a.trim(); }).filter(Boolean);
    };

    var cleanTitle = stripFeat(track);
    var artistParts = splitArtists(artist);
    var primaryArtist = artistParts[0] || '';
    var targetArtists = artistParts.map(norm).filter(Boolean);
    var nTitleClean = norm(cleanTitle);
    var nTitleFull = norm(track);

    var titleOk = function (rTitle) {
      var a = norm(rTitle), b = norm(stripFeat(rTitle));
      return (!!a && nTitleFull && (a.indexOf(nTitleFull) !== -1 || nTitleFull.indexOf(a) !== -1)) ||
             (!!b && !!nTitleClean && (b.indexOf(nTitleClean) !== -1 || nTitleClean.indexOf(b) !== -1));
    };
    var artistOk = function (rArtist) {
      var ra = norm(rArtist);
      if (!ra) return false;
      return targetArtists.some(function (ta) { return ta && (ra.indexOf(ta) !== -1 || ta.indexOf(ra) !== -1); });
    };

    // Fast path: when every selected library is fully indexed, resolve locally
    // (no network) against the in-memory title index. The app's findBestMatch /
    // calculateConfidence still do the final ID-first scoring on what we return.
    if (this._allIndexed(config)) {
      var idxCands = this._indexCandidatesByTitle(config, nTitleClean, nTitleFull);
      var idxExact = idxCands.find(function (r) { return (norm(r.title) === nTitleFull || norm(stripFeat(r.title)) === nTitleClean) && artistOk(r.artist); });
      if (idxExact) { console.log('Plex index match:', idxExact.artist, '-', idxExact.title); return idxExact; }
      var idxFuzzy = idxCands.find(function (r) { return titleOk(r.title) && artistOk(r.artist); });
      if (idxFuzzy) return idxFuzzy;
      var idxTitleOnly = idxCands.find(function (r) { return titleOk(r.title); });
      return idxTitleOnly || null;
    }

    var seen = {}, queries = [];
    var addQ = function (q) { q = (q || '').trim(); var k = q.toLowerCase(); if (q && !seen[k]) { seen[k] = true; queries.push(q); } };
    addQ(cleanTitle);
    addQ((primaryArtist + ' ' + cleanTitle).trim());
    addQ(track);

    var fallback = null;
    for (var qi = 0; qi < queries.length; qi++) {
      var results = await self.search(queries[qi], config);
      for (var i = 0; i < results.length; i++) {
        var r = results[i];
        if (!titleOk(r.title)) continue;
        if (artistOk(r.artist)) {
          console.log('Plex resolve matched:', r.artist, '-', r.title);
          return r;
        }
        if (!fallback) fallback = r;
      }
    }
    return fallback;
  },

  // Stream URL for a track: the server's token and connections come from the
  // saved config (never from the track). Null when the server is unreachable.
  getStreamUrl: async function (track, config) {
    if (!track || !track.plexPartKey || !track.plexServerId) { console.error('Plex: no stream key for track'); return null; }
    var server = await this._serverFor(track.plexServerId, config);
    if (!server || !server.accessToken) { console.error('Plex: server', track.plexServerName || track.plexServerId, 'is not in the saved library selection'); return null; }
    var base = await this._baseUrl(server);
    if (!base) { console.error('Plex: no reachable connection for', track.plexServerName || track.plexServerId); return null; }
    return base + track.plexPartKey + '?X-Plex-Token=' + encodeURIComponent(server.accessToken);
  },

  // Resolver play contract: the app streams the returned URL through its
  // shared HTML5 audio element.
  play: async function (track, config) {
    var streamUrl = await this.getStreamUrl(track, config);
    if (!streamUrl) return false;
    console.log('Plex streaming:', track.title, 'by', track.artist);
    return { type: 'local', url: streamUrl };
  },

  // app.plex.tv share links carry the server id and a metadata key. Album and
  // track links share the same key shape, so this fetches the metadata first;
  // an album key is answered through lookupAlbum (the result then carries
  // `tracks`, which the URL-import path treats as an album).
  lookupUrl: async function (url, config) {
    try {
      var serverId = null;
      var sm = url.match(/\/server\/([0-9a-f]+)/i);
      if (sm) serverId = sm[1];
      var keyMatch = url.match(/key=([^&]+)/);
      if (!keyMatch) { console.log('Could not extract key from Plex URL'); return null; }
      var metadataKey = decodeURIComponent(keyMatch[1]);
      var server = serverId ? await this._serverFor(serverId, config) : null;
      if (!server && config && config.libraries && config.libraries.length) {
        var l0 = config.libraries[0];
        server = { serverId: l0.serverId, serverName: l0.serverName, accessToken: l0.accessToken, connections: l0.connections };
      }
      if (!server) return null;
      var base = await this._baseUrl(server);
      if (!base) return null;
      var resp = await this._fetch(base + metadataKey + '?includeGuids=1&X-Plex-Token=' + encodeURIComponent(server.accessToken), { headers: { 'Accept': 'application/json' } });
      if (!resp.ok) { console.error('Plex metadata lookup failed:', resp.status); return null; }
      var data = await resp.json();
      var c = data.MediaContainer;
      if (!c || !c.Metadata || !c.Metadata[0]) return null;
      var t = c.Metadata[0];
      if (t.type === 'album') return this.lookupAlbum(url, config);
      if (t.type !== 'track') return null;
      return this._mapTrack(t, server, base);
    } catch (e) {
      console.error('Plex URL lookup error:', e);
      return null;
    }
  },

  lookupAlbum: async function (url, config) {
    try {
      var serverId = null;
      var sm = url.match(/\/server\/([0-9a-f]+)/i);
      if (sm) serverId = sm[1];
      var keyMatch = url.match(/key=([^&]+)/);
      if (!keyMatch) return null;
      var metadataKey = decodeURIComponent(keyMatch[1]);
      var server = serverId ? await this._serverFor(serverId, config) : null;
      if (!server && config && config.libraries && config.libraries.length) {
        var l0 = config.libraries[0];
        server = { serverId: l0.serverId, serverName: l0.serverName, accessToken: l0.accessToken, connections: l0.connections };
      }
      if (!server) return null;
      var base = await this._baseUrl(server);
      if (!base) return null;
      var tok = encodeURIComponent(server.accessToken);
      var aResp = await this._fetch(base + metadataKey + '?includeGuids=1&X-Plex-Token=' + tok, { headers: { 'Accept': 'application/json' } });
      if (!aResp.ok) return null;
      var aData = await aResp.json();
      var ac = aData.MediaContainer;
      if (!ac || !ac.Metadata || !ac.Metadata[0]) return null;
      var album = ac.Metadata[0];
      if (album.type !== 'album') return null;
      var cResp = await this._fetch(base + metadataKey + '/children?includeGuids=1&X-Plex-Token=' + tok, { headers: { 'Accept': 'application/json' } });
      if (!cResp.ok) return null;
      var cData = await cResp.json();
      var cc = cData.MediaContainer;
      var albumArt = album.thumb ? base + album.thumb + '?X-Plex-Token=' + tok : null;
      var tracks = [];
      if (cc && cc.Metadata) {
        for (var i = 0; i < cc.Metadata.length; i++) {
          var mt = this._mapTrack(cc.Metadata[i], server, base);
          if (!mt.album) mt.album = album.title || '';
          if (!mt.albumArt) mt.albumArt = albumArt;
          mt.artist = cc.Metadata[i].grandparentTitle || album.parentTitle || mt.artist;
          tracks.push(mt);
        }
      }
      tracks.sort(function (a, b) { return (a.trackNumber || 0) - (b.trackNumber || 0); });
      return {
        id: 'plex-album-' + album.ratingKey,
        name: album.title || '',
        title: album.title || '',
        artist: album.parentTitle || 'Unknown Artist',
        albumArt: albumArt,
        releaseDate: album.originallyAvailableAt || '',
        trackCount: tracks.length,
        tracks: tracks,
        url: url
      };
    } catch (e) {
      console.error('Plex album lookup error:', e);
      return null;
    }
  },

  lookupPlaylist: async function (url, config) {
    try {
      var serverId = null;
      var sm = url.match(/\/server\/([0-9a-f]+)/i);
      if (sm) serverId = sm[1];
      var playlistId = null;
      var keyMatch = url.match(/key=([^&]+)/);
      if (keyMatch) {
        var mk = decodeURIComponent(keyMatch[1]);
        var im = mk.match(/\/playlists\/(\d+)/);
        if (im) playlistId = im[1];
      }
      if (!playlistId) {
        var pm = url.match(/\/playlists\/(\d+)/);
        if (pm) playlistId = pm[1];
      }
      if (!playlistId) return null;
      var server = serverId ? await this._serverFor(serverId, config) : null;
      if (!server && config && config.libraries && config.libraries.length) {
        var l0 = config.libraries[0];
        server = { serverId: l0.serverId, serverName: l0.serverName, accessToken: l0.accessToken, connections: l0.connections };
      }
      if (!server) return null;
      var base = await this._baseUrl(server);
      if (!base) return null;
      var tok = encodeURIComponent(server.accessToken);
      var pResp = await this._fetch(base + '/playlists/' + playlistId + '?X-Plex-Token=' + tok, { headers: { 'Accept': 'application/json' } });
      if (!pResp.ok) { console.error('Plex playlist fetch failed:', pResp.status); return null; }
      var pData = await pResp.json();
      var pc = pData.MediaContainer;
      if (!pc || !pc.Metadata || !pc.Metadata[0]) return null;
      var playlist = pc.Metadata[0];
      var iResp = await this._fetch(base + '/playlists/' + playlistId + '/items?includeGuids=1&X-Plex-Token=' + tok, { headers: { 'Accept': 'application/json' } });
      if (!iResp.ok) { console.error('Plex playlist items fetch failed:', iResp.status); return null; }
      var iData = await iResp.json();
      var ic = iData.MediaContainer;
      var tracks = [];
      if (ic && ic.Metadata) {
        for (var i = 0; i < ic.Metadata.length; i++) {
          if (ic.Metadata[i].type !== 'track') continue;
          tracks.push(this._mapTrack(ic.Metadata[i], server, base));
        }
      }
      console.log('Plex playlist loaded:', playlist.title, '(' + tracks.length + ' tracks)');
      return {
        id: 'plex-playlist-' + playlistId,
        name: playlist.title || '',
        owner: '',
        albumArt: playlist.composite ? base + playlist.composite + '?X-Plex-Token=' + tok : null,
        trackCount: tracks.length,
        tracks: tracks,
        url: url
      };
    } catch (e) {
      console.error('Plex playlist lookup error:', e);
      return null;
    }
  },

  init: async function (config) {
    if (!config || !config.libraries || !config.libraries.length) {
      console.log('Plex: awaiting sign-in and library selection');
      return;
    }
    var n = config.libraries.length;
    console.log('Plex: ' + n + ' librar' + (n === 1 ? 'y' : 'ies') + ' configured; building search index in background');
    try { this.buildIndex(config); } catch (e) { /* index build is best-effort */ }
  },

  cleanup: async function () {
    console.log('Plex resolver cleanup');
    this.clearIndex();
  }
};
