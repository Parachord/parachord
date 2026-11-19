// Discogs plug-in (plugins/discogs.axe). Edit here, bump manifest.version in
// manifest.json, then run `node scripts/build-axes.js`.
// The functions materialize fully isolated (resolver-loader.js uses
// new Function) — no shared scope between them; helpers must be embedded per function.
module.exports = {
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
