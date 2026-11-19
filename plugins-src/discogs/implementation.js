// Discogs plug-in (plugins/discogs.axe). Edit here, bump manifest.version in
// manifest.json, then run `node scripts/build-axes.js`.
// The functions materialize fully isolated (resolver-loader.js uses
// new Function): the one shared scope is the _lib factory below, which every
// method reaches as this.lib (helpers and constants only).
module.exports = {
  _lib: function () {
    // ── Discogs profile markup ──
    // Discogs artist profiles use their own markup: [b]bold[/b], [i]…[/i],
    // [u]…[/u], [url=https://…]text[/url], and references to other entities
    // either by name ([a=Artist], [l=Label], [r=Release], [m=Master]) or by
    // id ([a17632854]). A band whose profile listed its members by id showed
    // "[a17632854] – vocals" on the artist page (2026-10).
    //
    // normalizeProfile resolves references to plain names (ids through a
    // name map getArtistBio fetched) and keeps the formatting tags, which the
    // app renders (the bio's markup: 'bbcode', src/renderer/lib/bio-markup.js).
    var REF_ID = /\[([alrm])(\d+)\]/g;
    var MAX_REF_LOOKUPS = 8;
    // The API path for a reference type.
    var REF_PATH = { a: 'artists', l: 'labels', r: 'releases', m: 'masters' };
    // Discogs disambiguates same-named artists with a " (2)" suffix.
    var stripDisambiguation = function (name) { return String(name || '').replace(/\s+\(\d+\)$/, '').trim(); };

    // Distinct id references in a profile, in order: [{ type: 'a'|'l'|'r'|'m', id }].
    var refIds = function (profile) {
      var seen = {};
      var refs = [];
      var re = new RegExp(REF_ID.source, 'g');
      var m;
      while ((m = re.exec(String(profile || ''))) !== null) {
        var key = m[1] + m[2];
        if (seen[key]) continue;
        seen[key] = true;
        refs.push({ type: m[1], id: m[2] });
      }
      return refs;
    };

    // names: { 'a17632854': 'Iryna Panchuk', ... }. A reference with no name
    // is dropped rather than shown as a bare id.
    var normalizeProfile = function (profile, names) {
      var map = names || {};
      return String(profile || '')
        .replace(/\r\n?/g, '\n')
        .replace(new RegExp(REF_ID.source, 'g'), function (_, type, id) { return stripDisambiguation(map[type + id] || ''); })
        .replace(/\[([alrm])=([^\]]+)\]/g, function (_, _type, name) { return stripDisambiguation(name); })
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n[ \t]+/g, '\n') // a dropped reference at a line start leaves a space
        .trim();
    };

    return {
      REF_PATH: REF_PATH,
      MAX_REF_LOOKUPS: MAX_REF_LOOKUPS,
      stripDisambiguation: stripDisambiguation,
      refIds: refIds,
      normalizeProfile: normalizeProfile
    };
  },

  // The biography capability (#1539 step 6), moved out of app.js
  // (getDiscogsBio). No account needed; a personal access token (Advanced)
  // raises the rate limit. artist: { name }. Searches by name and takes the
  // result with the same name (ignoring case), else the first; then the
  // artist's profile, with its references resolved to names (the artist's
  // own member, group and alias lists first, then at most MAX_REF_LOOKUPS
  // lookups). Answers { text, url, markup: 'bbcode' } (the profile keeps
  // Discogs's [b], [i], [u] and [url=] tags), or null when Discogs doesn't
  // know the artist or has no profile. A failed request THROWS.
  getArtistBio: async function (artist, config) {
    var lib = this.lib;
    var name = artist && typeof artist.name === 'string' ? artist.name.trim() : '';
    if (!name) return null;
    var headers = { 'User-Agent': 'Parachord/1.0 (https://parachord.app)' };
    var token = config && config.personalAccessToken;
    if (token) headers.Authorization = 'Discogs token=' + token;
    var get = async function (url) {
      var response = await fetch(url, { headers: headers });
      if (!response.ok) throw new Error('Discogs bio failed: ' + response.status);
      return response.json();
    };
    var search = await get('https://api.discogs.com/database/search?q=' + encodeURIComponent(name) + '&type=artist&per_page=5');
    var results = (search && search.results) || [];
    var lower = name.toLowerCase();
    var found = results.find(function (r) { return r && typeof r.title === 'string' && r.title.toLowerCase() === lower; }) || results[0];
    if (!found || !found.id) return null;
    var data = await get('https://api.discogs.com/artists/' + encodeURIComponent(found.id));
    if (!data || typeof data.profile !== 'string' || !data.profile.trim()) return null;
    var refNames = {};
    [data.members, data.groups, data.aliases].forEach(function (list) {
      (list || []).forEach(function (e) { if (e && e.id && e.name) refNames['a' + e.id] = e.name; });
    });
    var missing = lib.refIds(data.profile)
      .filter(function (r) { return !refNames[r.type + r.id]; })
      .slice(0, lib.MAX_REF_LOOKUPS);
    await Promise.all(missing.map(async function (r) {
      try {
        var ref = await get('https://api.discogs.com/' + lib.REF_PATH[r.type] + '/' + r.id);
        var refName = ref && (ref.name || ref.title);
        if (refName) refNames[r.type + r.id] = refName;
      } catch (_e) { /* dropped from the bio */ }
    }));
    var text = lib.normalizeProfile(data.profile, refNames);
    if (!text) return null;
    var url = typeof data.uri === 'string' && /^https:\/\//.test(data.uri) ? data.uri : 'https://www.discogs.com/artist/' + data.id;
    return { text: text, url: url, markup: 'bbcode' };
  },

  // The artistReleases capability (#1539 step 2): the artist page's
  // discography when MusicBrainz is slow or doesn't know the artist, moved
  // out of app.js (fetchArtistFromDiscogs). No account needed; a personal
  // access token (Advanced) raises the rate limit. artist: { name }. Answers
  // { artist: { name }, releases: [{ id, title, date, releaseType, albumArt }] }
  // with Discogs's release ids (the app prefixes them "discogs-"), newest
  // first, one per title (Discogs lists every regional edition), and only
  // releases where the artist is the main artist. null when Discogs doesn't
  // know the artist; a failed request THROWS.
  getArtistReleases: async function (artist, config) {
    var name = artist && typeof artist.name === 'string' ? artist.name.trim() : '';
    if (!name) return null;
    var headers = { 'User-Agent': 'Parachord/1.0 (https://parachord.app)' };
    var token = config && config.personalAccessToken;
    if (token) headers.Authorization = 'Discogs token=' + token;
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
      var response = await fetch(url, { headers: headers });
      if (!response.ok) throw new Error('Discogs artist releases failed: ' + response.status);
      return response.json();
    };
    var search = await get('https://api.discogs.com/database/search?q=' + encodeURIComponent(name) + '&type=artist&per_page=5');
    var found = pickArtist((search && search.results) || [], function (r) { return r && r.title; });
    if (!found || !found.id) return null;
    var data = await get('https://api.discogs.com/artists/' + encodeURIComponent(found.id) + '/releases?sort=year&sort_order=desc&per_page=100');
    var seen = {};
    var releases = [];
    ((data && data.releases) || []).forEach(function (rel) {
      if (!rel || !rel.id || typeof rel.title !== 'string') return;
      if (rel.role && rel.role !== 'Main') return;
      var key = rel.title.toLowerCase();
      if (!key || seen[key]) return;
      seen[key] = true;
      var format = String(rel.format || '').toLowerCase();
      var releaseType = 'album';
      if (format.indexOf('single') !== -1 || rel.type === 'Single') releaseType = 'single';
      else if (format.indexOf('ep') !== -1) releaseType = 'ep';
      else if (format.indexOf('compilation') !== -1) releaseType = 'compilation';
      releases.push({
        id: String(rel.id),
        title: rel.title,
        date: rel.year ? String(rel.year) : null,
        releaseType: releaseType,
        albumArt: rel.thumb || null
      });
    });
    return { artist: { name: found.title }, releases: releases };
  }
};
