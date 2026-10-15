// Subsonic resolver generator. The implementation functions here are the
// source of truth; the script writes:
//
//   plugins/subsonic.axe            (pretty-printed plugin file)
//   app.js FALLBACK_RESOLVERS       (compact single-line copy, byte-identical)
//   marketplace-manifest.json       (version + entry)
//
// Keeping the three in step is enforced by tests/plugins/bundled-plugin-consistency.test.js.
// Rerun this script after editing anything below (and bump VERSION).
//
// Implementation notes (why this looks the way it does):
//  - Every .axe implementation function is materialized with `new Function()`
//    in resolver-loader.js, so functions are fully isolated — no shared scope.
//    The md5 + URL helpers are therefore embedded verbatim in BOTH `search`
//    and `getStreamUrl` (identical text), and installed lazily on
//    window.__subsonicHelpers so only the first definition wins.
//  - md5 is Joseph Myers' public-domain implementation — the same one the
//    official Subsonic API demo page ships — needed for token auth
//    (t = md5(password + salt)). No WebCrypto MD5 exists, and the renderer
//    has no Node crypto.
//  - ES5-level syntax throughout (the mobile plugin runtime evaluates these
//    too; see the bandcamp .axe note about engine-portable normalization).

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const VERSION = '0.1.0';

// ---------------------------------------------------------------------------
// Shared helper block. Embedded verbatim at the top of `search` and
// `getStreamUrl` (see notes above).
// ---------------------------------------------------------------------------
const HELPERS = `
  var ensureHelpers = function() {
    if (window.__subsonicHelpers) return window.__subsonicHelpers;
    var md5cycle = function(x, k) {
      var a = x[0], b = x[1], c = x[2], d = x[3];
      a = ff(a, b, c, d, k[0], 7, -680876936);
      d = ff(d, a, b, c, k[1], 12, -389564586);
      c = ff(c, d, a, b, k[2], 17, 606105819);
      b = ff(b, c, d, a, k[3], 22, -1044525330);
      a = ff(a, b, c, d, k[4], 7, -176418897);
      d = ff(d, a, b, c, k[5], 12, 1200080426);
      c = ff(c, d, a, b, k[6], 17, -1473231341);
      b = ff(b, c, d, a, k[7], 22, -45705983);
      a = ff(a, b, c, d, k[8], 7, 1770035416);
      d = ff(d, a, b, c, k[9], 12, -1958414417);
      c = ff(c, d, a, b, k[10], 17, -42063);
      b = ff(b, c, d, a, k[11], 22, -1990404162);
      a = ff(a, b, c, d, k[12], 7, 1804603682);
      d = ff(d, a, b, c, k[13], 12, -40341101);
      c = ff(c, d, a, b, k[14], 17, -1502002290);
      b = ff(b, c, d, a, k[15], 22, 1236535329);
      a = gg(a, b, c, d, k[1], 5, -165796510);
      d = gg(d, a, b, c, k[6], 9, -1069501632);
      c = gg(c, d, a, b, k[11], 14, 643717713);
      b = gg(b, c, d, a, k[0], 20, -373897302);
      a = gg(a, b, c, d, k[5], 5, -701558691);
      d = gg(d, a, b, c, k[10], 9, 38016083);
      c = gg(c, d, a, b, k[15], 14, -660478335);
      b = gg(b, c, d, a, k[4], 20, -405537848);
      a = gg(a, b, c, d, k[9], 5, 568446438);
      d = gg(d, a, b, c, k[14], 9, -1019803690);
      c = gg(c, d, a, b, k[3], 14, -187363961);
      b = gg(b, c, d, a, k[8], 20, 1163531501);
      a = gg(a, b, c, d, k[13], 5, -1444681467);
      d = gg(d, a, b, c, k[2], 9, -51403784);
      c = gg(c, d, a, b, k[7], 14, 1735328473);
      b = gg(b, c, d, a, k[12], 20, -1926607734);
      a = hh(a, b, c, d, k[5], 4, -378558);
      d = hh(d, a, b, c, k[8], 11, -2022574463);
      c = hh(c, d, a, b, k[11], 16, 1839030562);
      b = hh(b, c, d, a, k[14], 23, -35309556);
      a = hh(a, b, c, d, k[1], 4, -1530992060);
      d = hh(d, a, b, c, k[4], 11, 1272893353);
      c = hh(c, d, a, b, k[7], 16, -155497632);
      b = hh(b, c, d, a, k[10], 23, -1094730640);
      a = hh(a, b, c, d, k[13], 4, 681279174);
      d = hh(d, a, b, c, k[0], 11, -358537222);
      c = hh(c, d, a, b, k[3], 16, -722521979);
      b = hh(b, c, d, a, k[6], 23, 76029189);
      a = hh(a, b, c, d, k[9], 4, -640364487);
      d = hh(d, a, b, c, k[12], 11, -421815835);
      c = hh(c, d, a, b, k[15], 16, 530742520);
      b = hh(b, c, d, a, k[2], 23, -995338651);
      a = ii(a, b, c, d, k[0], 6, -198630844);
      d = ii(d, a, b, c, k[7], 10, 1126891415);
      c = ii(c, d, a, b, k[14], 15, -1416354905);
      b = ii(b, c, d, a, k[5], 21, -57434055);
      a = ii(a, b, c, d, k[12], 6, 1700485571);
      d = ii(d, a, b, c, k[3], 10, -1894986606);
      c = ii(c, d, a, b, k[10], 15, -1051523);
      b = ii(b, c, d, a, k[1], 21, -2054922799);
      a = ii(a, b, c, d, k[8], 6, 1873313359);
      d = ii(d, a, b, c, k[15], 10, -30611744);
      c = ii(c, d, a, b, k[6], 15, -1560198380);
      b = ii(b, c, d, a, k[13], 21, 1309151649);
      a = ii(a, b, c, d, k[4], 6, -145523070);
      d = ii(d, a, b, c, k[11], 10, -1120210379);
      c = ii(c, d, a, b, k[2], 15, 718787259);
      b = ii(b, c, d, a, k[9], 21, -343485551);
      x[0] = add32(a, x[0]);
      x[1] = add32(b, x[1]);
      x[2] = add32(c, x[2]);
      x[3] = add32(d, x[3]);
    };
    var cmn = function(q, a, b, x, s, t) {
      a = add32(add32(a, q), add32(x, t));
      return add32((a << s) | (a >>> (32 - s)), b);
    };
    var ff = function(a, b, c, d, x, s, t) { return cmn((b & c) | ((~b) & d), a, b, x, s, t); };
    var gg = function(a, b, c, d, x, s, t) { return cmn((b & d) | (c & (~d)), a, b, x, s, t); };
    var hh = function(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); };
    var ii = function(a, b, c, d, x, s, t) { return cmn(c ^ (b | (~d)), a, b, x, s, t); };
    var md51 = function(s) {
      var n = s.length, state = [1732584193, -271733879, -1732584194, 271733878], i;
      for (i = 64; i <= s.length; i += 64) {
        md5cycle(state, md5blk(s.substring(i - 64, i)));
      }
      s = s.substring(i - 64);
      var tail = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (i = 0; i < s.length; i++)
        tail[i >> 2] |= s.charCodeAt(i) << ((i % 4) << 3);
      tail[i >> 2] |= 0x80 << ((i % 4) << 3);
      if (i > 55) {
        md5cycle(state, tail);
        for (i = 0; i < 16; i++) tail[i] = 0;
      }
      tail[14] = n * 8;
      md5cycle(state, tail);
      return state;
    };
    var md5blk = function(s) {
      var md5blks = [], i;
      for (i = 0; i < 64; i += 4) {
        md5blks[i >> 2] = s.charCodeAt(i) + (s.charCodeAt(i + 1) << 8) + (s.charCodeAt(i + 2) << 16) + (s.charCodeAt(i + 3) << 24);
      }
      return md5blks;
    };
    var hex_chr = '0123456789abcdef'.split('');
    var rhex = function(n) {
      var s = '', j = 0;
      for (; j < 4; j++)
        s += hex_chr[(n >> (j * 8 + 4)) & 0x0f] + hex_chr[(n >> (j * 8)) & 0x0f];
      return s;
    };
    var hex = function(x) {
      for (var i = 0; i < x.length; i++) x[i] = rhex(x[i]);
      return x.join('');
    };
    var hexmd5 = function(s) { return hex(md51(unescape(encodeURIComponent(s)))); };
    var add32 = function(a, b) { return (a + b) & 0xffffffff; };
    // ---- Subsonic URL builders ----
    // Tolerate "http://host:4533", "http://host:4533/", "http://host:4533/rest"
    // and "http://host:4533/rest/" — every one of those gets pasted by users.
    var normalizeBase = function(raw) {
      var u = (raw || '').toString().trim();
      if (!u) return null;
      if (!/^https?:\\/\\//i.test(u)) u = 'http://' + u;
      u = u.replace(/\\/+$/, '');
      u = u.replace(/\\/rest$/i, '');
      return u;
    };
    var makeSalt = function() {
      try {
        if (window.crypto && window.crypto.getRandomValues) {
          var bytes = new Uint8Array(6);
          window.crypto.getRandomValues(bytes);
          var s = '';
          for (var i = 0; i < bytes.length; i++) s += ('0' + bytes[i].toString(16)).slice(-2);
          return s;
        }
      } catch (e) {}
      return ('' + Math.random()).slice(2, 14);
    };
    // Token auth (Subsonic API >= 1.13): t = md5(password + salt). The
    // plaintext password never appears in a URL.
    var authParams = function(config) {
      var salt = makeSalt();
      var token = hexmd5(((config && config.password) || '') + salt);
      return 'u=' + encodeURIComponent((config && config.username) || '') + '&t=' + token + '&s=' + salt + '&v=1.16.1&c=parachord';
    };
    var apiUrl = function(config, endpoint, extra) {
      var base = normalizeBase(config && config.serverUrl);
      if (!base) return null;
      var url = base + '/rest/' + endpoint + '.view?' + authParams(config);
      if (extra) url += '&' + extra;
      return url;
    };
    window.__subsonicHelpers = { hexmd5: hexmd5, normalizeBase: normalizeBase, authParams: authParams, apiUrl: apiUrl };
    return window.__subsonicHelpers;
  };
`;

const SEARCH = `async function(query, config) {
  try {
    if (typeof query !== 'string' || !query.trim() || query.trim().length < 2) return [];
${HELPERS}
    var h = ensureHelpers();
    var url = h.apiUrl(config, 'search3', 'f=json&query=' + encodeURIComponent(query.trim()) + '&songCount=20&artistCount=0&albumCount=0');
    if (!url) {
      console.log('Subsonic: no server URL configured, skipping search');
      return [];
    }
    var resp = await fetch(url);
    if (!resp.ok) {
      console.warn('Subsonic: search failed, HTTP ' + resp.status);
      return [];
    }
    var data = await resp.json();
    var sub = data && data['subsonic-response'];
    if (!sub || sub.status !== 'ok') {
      var apiErr = sub && sub.error ? (sub.error.code + ' ' + sub.error.message) : 'bad response';
      console.warn('Subsonic: API error:', apiErr);
      return [];
    }
    var songs = (sub.searchResult3 && sub.searchResult3.song) || [];
    var results = [];
    for (var i = 0; i < songs.length; i++) {
      var s = songs[i];
      if (!s || !s.id || !s.title) continue;
      var track = {
        id: 'subsonic-' + s.id,
        title: s.title,
        artist: s.artist || 'Unknown Artist',
        album: s.album || '',
        duration: s.duration || 0,
        sources: ['subsonic'],
        subsonicId: s.id,
        subsonicServer: h.normalizeBase(config && config.serverUrl),
        subsonicStreamUrl: h.apiUrl(config, 'stream', 'id=' + encodeURIComponent(s.id) + '&maxBitRate=0'),
        genre: s.genre || null,
        year: s.year || null,
        trackNumber: s.track || null
      };
      if (s.coverArt) {
        track.albumArt = h.apiUrl(config, 'getCoverArt', 'id=' + encodeURIComponent(s.coverArt) + '&size=300');
      }
      // ISRC per the cross-cutting resolver result shape: upper-case,
      // trimmed, format-validated. OpenSubsonic servers return a string or
      // an array (Navidrome: array, usually empty).
      var isrcRaw = '';
      if (typeof s.isrc === 'string') isrcRaw = s.isrc;
      else if (s.isrc && s.isrc.length) isrcRaw = String(s.isrc[0] || '');
      var isrc = (isrcRaw || '').toUpperCase().trim();
      if (/^[A-Z]{2}[A-Z0-9]{3}\\d{7}$/.test(isrc)) track.isrc = isrc;
      // streamQuality per the stream-quality.js contract. These are the
      // server's tagged file properties ('claimed' — the server may still
      // transcode on stream.view, so they are not measured).
      var suffix = s.suffix ? String(s.suffix).toLowerCase() : '';
      if (suffix || s.bitRate || s.samplingRate) {
        var sq = { origin: 'claimed' };
        if (suffix) { sq.codec = suffix; sq.container = suffix; }
        if (s.bitRate) sq.bitrate = s.bitRate;
        if (s.samplingRate) sq.sampleRate = s.samplingRate;
        if (s.bitDepth) sq.bitDepth = s.bitDepth;
        if (s.channelCount) sq.channels = s.channelCount;
        track.streamQuality = sq;
      }
      results.push(track);
    }
    console.log('Subsonic: found ' + results.length + ' song(s) for "' + query + '"');
    return results;
  } catch (error) {
    console.error('Subsonic search error:', error);
    return [];
  }
}`;

const RESOLVE = `async function(artist, track, album, config) {
  // Containment-match on both axes (same shape as the platform's
  // validateResolvedTrack gate). No fallback to a fuzzy top hit: the 0.6
  // confidence floor drops a single-axis match anyway, so returning one only
  // pollutes the source cache.
  var norm = function(s) { s = (s || '').toString().toLowerCase(); return s.replace(/[^a-z0-9]/g, ''); };
  var contains = function(a, b) { return !!a && !!b && (a.indexOf(b) !== -1 || b.indexOf(a) !== -1); };
  var targetArtist = norm(artist);
  var targetTitle = norm(track);
  var query = ((artist || '') + ' ' + (track || '')).trim();
  if (!query) return null;
  var results = await this.search(query, config);
  if (!results || results.length === 0) return null;
  for (var i = 0; i < results.length; i++) {
    if (contains(norm(results[i].artist), targetArtist) && contains(norm(results[i].title), targetTitle)) return results[i];
  }
  return null;
}`;

const GET_STREAM_URL = `async function(track, config) {
${HELPERS}
  try {
    var t = track || {};
    var subsonicId = t.subsonicId || (t.sources && t.sources.subsonic && t.sources.subsonic.subsonicId) || null;
    if (!subsonicId) return null;
    var h = ensureHelpers();
    // Fresh credentials win: a changed password invalidates any URL baked
    // at search time, so rebuild from config whenever all three fields are
    // present.
    var cfg = config || {};
    if (cfg.serverUrl && cfg.username && typeof cfg.password === 'string') {
      var fresh = h.apiUrl(cfg, 'stream', 'id=' + encodeURIComponent(subsonicId) + '&maxBitRate=0');
      if (fresh) return fresh;
    }
    // Fall back to the URL baked onto the source at search/resolve time.
    return t.subsonicStreamUrl || (t.sources && t.sources.subsonic && t.sources.subsonic.subsonicStreamUrl) || null;
  } catch (error) {
    console.error('Subsonic getStreamUrl error:', error);
    return null;
  }
}`;

const PLAY = `async function(track, config) {
  // In-app streaming playback is host-owned: handlePlay's subsonic branch
  // streams via the shared HTML5 audio element and never reaches this.
  // Hosts without that branch get an honest failure instead of ghost audio.
  console.log('Subsonic: play() is host-owned (HTML5 audio branch in handlePlay); not handled here');
  return false;
}`;

const INIT = `async function(config) {
  console.log('Subsonic resolver initialized');
  return true;
}`;

const CLEANUP = `async function() {
  console.log('Subsonic resolver cleanup');
}`;

const axe = {
  manifest: {
    id: 'subsonic',
    name: 'Subsonic',
    version: VERSION,
    author: 'Parachord Team',
    description: 'Stream music from your self-hosted Subsonic-compatible server (Navidrome, Subsonic, Airsonic, Gonic, ...). Configure the server URL, username and password in settings.',
    icon: '📡',
    color: '#14b8a6',
    homepage: 'https://subsonic.org',
    email: ''
  },
  capabilities: {
    resolve: true,
    search: true,
    stream: true,
    browse: false,
    urlLookup: false
  },
  urlPatterns: [],
  settings: {
    requiresAuth: true,
    authType: 'apikey',
    // `password` must stay FIRST: the settings panel's API Configuration
    // block renders the first configurable field as the (masked) auth field,
    // and the generic extra-field renderer has no password input type.
    configurable: {
      password: {
        type: 'password',
        label: 'Password',
        description: 'Your Subsonic account password. Sent as an MD5 token (salt + hash), never in plain text.'
      },
      serverUrl: {
        type: 'text',
        label: 'Server URL',
        description: 'Base URL of your Subsonic-compatible server. A trailing /rest is tolerated (e.g. http://192.168.0.13:4533 or http://navidrome.local:4533/rest).',
        placeholder: 'http://navidrome.local:4533'
      },
      username: {
        type: 'text',
        label: 'Username',
        description: 'Your Subsonic account username.',
        placeholder: 'admin'
      }
    }
  },
  implementation: {
    search: SEARCH,
    resolve: RESOLVE,
    getStreamUrl: GET_STREAM_URL,
    play: PLAY,
    init: INIT,
    cleanup: CLEANUP
  }
};

// ---------------------------------------------------------------------------
// Write plugins/subsonic.axe
// ---------------------------------------------------------------------------
const axePath = path.join(ROOT, 'plugins', 'subsonic.axe');
fs.writeFileSync(axePath, JSON.stringify(axe, null, 2) + '\n');
console.log('✅ Wrote plugins/subsonic.axe v' + VERSION);

// ---------------------------------------------------------------------------
// Update app.js FALLBACK_RESOLVERS
// ---------------------------------------------------------------------------
const appPath = path.join(ROOT, 'app.js');
const lines = fs.readFileSync(appPath, 'utf8').split('\n');
const start = lines.findIndex(l => l.startsWith('const FALLBACK_RESOLVERS = ['));
if (start === -1) throw new Error('FALLBACK_RESOLVERS not found in app.js');
const end = lines.findIndex((l, i) => i > start && l.startsWith('];'));

// Remove any existing subsonic entry, then insert the fresh one before the
// closing bracket (entries are order-independent; the loader matches by id).
const existingIdx = lines.findIndex((l, i) => i > start && i < end && l.includes('"id":"subsonic"'));
if (existingIdx !== -1) {
  lines.splice(existingIdx, 1);
}
// Re-scan the end after a potential splice
const end2 = lines.findIndex((l, i) => i > start && l.startsWith('];'));
const insertAt = end2 - 1;
const entry = '  ' + JSON.stringify(axe);
if (insertAt === start + 1) {
  // Empty array — no trailing comma needed on the previous entry
  lines.splice(insertAt, 0, entry);
} else {
  lines.splice(insertAt, 0, entry + ',');
  // Ensure the line before the new entry has a trailing comma
  const prev = lines[insertAt - 1];
  if (prev && !prev.trim().endsWith(',') && prev.trim().startsWith('{"manifest"')) {
    lines[insertAt - 1] = prev.replace(/\s*$/, ',');
  }
}
fs.writeFileSync(appPath, lines.join('\n'));
console.log('✅ Updated FALLBACK_RESOLVERS in app.js');

// ---------------------------------------------------------------------------
// Update marketplace-manifest.json
// ---------------------------------------------------------------------------
const manifestPath = path.join(ROOT, 'marketplace-manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const manifestEntry = {
  id: 'subsonic',
  name: 'Subsonic',
  version: VERSION,
  author: 'Parachord Team',
  description: axe.manifest.description,
  icon: axe.manifest.icon,
  color: axe.manifest.color,
  homepage: axe.manifest.homepage,
  capabilities: { ...axe.capabilities },
  requiresAuth: true,
  builtin: true,
  downloadUrl: 'https://raw.githubusercontent.com/Parachord/parachord-plugins/main/subsonic.axe',
  category: 'streaming',
  tags: ['self-hosted', 'subsonic', 'navidrome', 'streaming', 'personal-library']
};
const existing = manifest.plugins.findIndex(p => p.id === 'subsonic');
if (existing !== -1) {
  manifest.plugins[existing] = manifestEntry;
} else {
  manifest.plugins.push(manifestEntry);
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log('✅ Updated marketplace-manifest.json');
