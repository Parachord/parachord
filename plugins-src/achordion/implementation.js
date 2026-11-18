// Source of truth for plugins/achordion.axe v1.1.0.
// Imported from the .axe by `node scripts/build-axes.js --import`.
// Edit here, bump manifest.version in manifest.json, then run `node scripts/build-axes.js`.
// The functions materialize fully isolated (resolver-loader.js uses
// new Function) — no shared scope between them; helpers must be embedded per function.
module.exports = {
  init: async function (config) {
    const SUBMIT_ENDPOINT = 'https://achordion.xyz/api/track-links/submit';
    const ENTITY_LINK_ENDPOINT = 'https://achordion.xyz/api/entity-link';
    const BEARER_TOKEN = 'parachord_rgOgj2trN2KeIovar9DYA-yOCRkxgO6KlSyAo_jHtgg';
    const PER_SOURCE_MIN_CONFIDENCE = 0.95;
    const submittedThisSession = new Set();
    let authFailed = false;
    const isHttpUrl = function (u) {
      return typeof u === 'string' && (u.indexOf('http://') === 0 || u.indexOf('https://') === 0);
    };
    const linkForSource = function (resolverId, s) {
      if (!s || s.noMatch) return null;
      if (resolverId === 'spotify' && s.spotifyId) {
        return {
          url: 'https://open.spotify.com/track/' + s.spotifyId,
          host: 'spotify.com',
          label: 'Spotify',
        };
      }
      if (resolverId === 'applemusic') {
        const url =
          s.appleMusicUrl ||
          (s.appleMusicId ? 'https://music.apple.com/us/song/' + s.appleMusicId : null);
        if (url) return { url: url, host: 'music.apple.com', label: 'Apple Music' };
      }
      if (resolverId === 'bandcamp') {
        const url = s.bandcampUrl || s.url;
        if (isHttpUrl(url)) return { url: url, host: 'bandcamp.com', label: 'Bandcamp' };
      }
      if (resolverId === 'soundcloud') {
        const url = s.soundcloudUrl || s.permalink_url || s.url;
        if (isHttpUrl(url)) return { url: url, host: 'soundcloud.com', label: 'SoundCloud' };
      }
      if (resolverId === 'youtube' && s.youtubeId) {
        return {
          url: 'https://www.youtube.com/watch?v=' + s.youtubeId,
          host: 'youtube.com',
          label: 'YouTube',
        };
      }
      return null;
    };
    const buildLinks = function (track) {
      if (!track || !track.sources) return [];
      const out = [];
      const seen = new Set();
      for (const resolverId of Object.keys(track.sources)) {
        const s = track.sources[resolverId];
        if (!s || s.noMatch) continue;
        const conf = typeof s.confidence === 'number' ? s.confidence : 0;
        if (conf < PER_SOURCE_MIN_CONFIDENCE) continue;
        const link = linkForSource(resolverId, s);
        if (!link) continue;
        if (seen.has(link.url)) continue;
        seen.add(link.url);
        out.push(link);
      }
      return out;
    };
    const playedSourceConfidence = function (track) {
      const playedId = track && track._activeResolver;
      if (!playedId || !track.sources || !track.sources[playedId]) return 0;
      const c = track.sources[playedId].confidence;
      return typeof c === 'number' ? c : 0;
    };
    const trackLabel = function (track) {
      return ((track && track.artist) || '?') + ' — ' + ((track && track.title) || '?');
    };
    const resolveMbid = async function (track) {
      if (track && track.mbid && /^[a-f0-9-]{36}$/i.test(track.mbid)) return track.mbid;
      if (typeof window.resolveMbidForLove === 'function') {
        try {
          const mbid = await window.resolveMbidForLove(track);
          return mbid && /^[a-f0-9-]{36}$/i.test(mbid) ? mbid : null;
        } catch (e) {
          return null;
        }
      }
      return null;
    };
    const isValidIsrc = function (s) {
      return typeof s === 'string' && /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(s);
    };
    const resolveIsrc = function (track) {
      if (!track) return null;
      if (track.sources) {
        for (const id of Object.keys(track.sources)) {
          const s = track.sources[id];
          if (!s || s.noMatch) continue;
          if (typeof s.isrc === 'string' && s.isrc) {
            const norm = s.isrc.trim().toUpperCase();
            if (isValidIsrc(norm)) return norm;
          }
        }
      }
      if (typeof track.isrc === 'string' && track.isrc) {
        const norm = track.isrc.trim().toUpperCase();
        if (isValidIsrc(norm)) return norm;
      }
      return null;
    };
    const submit = async function (tier, track) {
      if (authFailed) {
        console.log('[achordion]', tier, 'skipped (auth-failed):', trackLabel(track));
        return { ok: false, reason: 'auth-failed' };
      }
      const mbid = await resolveMbid(track);
      const isrc = mbid ? null : resolveIsrc(track);
      if (!mbid && !isrc) {
        console.log(
          '[achordion]',
          tier,
          'skipped (no MBID or ISRC — cannot key submit):',
          trackLabel(track),
        );
        return { ok: false, reason: 'no-key' };
      }
      const dedupKey = mbid || 'isrc:' + isrc;
      if (submittedThisSession.has(dedupKey)) {
        console.log(
          '[achordion]',
          tier,
          'skipped (already submitted this session):',
          dedupKey,
          trackLabel(track),
        );
        return {
          ok: true,
          reason: 'already-submitted',
          mbid: mbid || undefined,
          isrc: isrc || undefined,
        };
      }
      const links = buildLinks(track);
      if (links.length === 0) {
        console.log(
          '[achordion]',
          tier,
          'skipped (no sources at >=' + PER_SOURCE_MIN_CONFIDENCE + ' with shareable URLs):',
          trackLabel(track),
          'sources=' + Object.keys(track.sources || {}).join(','),
        );
        return { ok: false, reason: 'no-links' };
      }
      submittedThisSession.add(dedupKey);
      const payload = {
        mbid: mbid || undefined,
        isrc: isrc || undefined,
        links: links,
        trackName: track.title || undefined,
        artistName: track.artist || undefined,
        albumName: track.album || undefined,
      };
      const hosts = links
        .map(function (l) {
          return l.host;
        })
        .join(',');
      console.log(
        '[achordion]',
        tier,
        'POSTing:',
        dedupKey,
        hosts,
        '(' + links.length + ' source' + (links.length === 1 ? '' : 's') + ')',
        trackLabel(track),
      );
      try {
        const res = await fetch(SUBMIT_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + BEARER_TOKEN,
            'X-Parachord-Client':
              (typeof window !== 'undefined' && window.__parachordClient) || 'unknown',
          },
          body: JSON.stringify(payload),
        });
        if (res.status === 401) {
          authFailed = true;
          console.warn('[achordion] auth failed (401) — suppressing submissions for this session');
          return { ok: false, reason: 'auth-failed' };
        }
        if (!res.ok) {
          console.warn('[achordion] submit returned HTTP', res.status, 'for', dedupKey);
          return { ok: false, reason: 'status-' + res.status };
        }
        console.log(
          '[achordion] ✅ submitted',
          dedupKey,
          '(' + links.length + ' link' + (links.length === 1 ? '' : 's') + ': ' + hosts + ')',
        );
        return {
          ok: true,
          mbid: mbid || undefined,
          isrc: isrc || undefined,
          hosts: hosts,
          count: links.length,
        };
      } catch (e) {
        console.warn('[achordion] submit error:', e && e.message ? e.message : e);
        return { ok: false, reason: 'network', message: e && e.message ? e.message : String(e) };
      }
    };
    const fetchEntityLink = async function (track, opts) {
      opts = opts || {};
      const mbid = await resolveMbid(track);
      if (!mbid) return { ok: false, reason: 'no-mbid' };
      const type = opts.type || 'track';
      const include = opts.includeNames ? '&include=names' : '';
      const url =
        ENTITY_LINK_ENDPOINT +
        '?type=' +
        encodeURIComponent(type) +
        '&mbid=' +
        encodeURIComponent(mbid) +
        include;
      try {
        const res = await fetch(url, {
          headers: {
            Authorization: 'Bearer ' + BEARER_TOKEN,
            'X-Parachord-Client':
              (typeof window !== 'undefined' && window.__parachordClient) || 'unknown',
          },
        });
        if (!res.ok) {
          console.warn('[achordion] entity-link returned HTTP', res.status, 'for', mbid);
          return { ok: false, reason: 'status-' + res.status, mbid: mbid };
        }
        const data = await res.json();
        console.log('[achordion] entity-link resolved:', mbid, '→', data.url);
        return {
          ok: true,
          mbid: mbid,
          url: data.url,
          embedUrl: data.embed_url || null,
          name: data.name || null,
          artistName: data.artist_name || null,
          albumName: data.album_name || null,
        };
      } catch (e) {
        console.warn('[achordion] entity-link error:', e && e.message ? e.message : e);
        return {
          ok: false,
          reason: 'network',
          message: e && e.message ? e.message : String(e),
          mbid: mbid,
        };
      }
    };
    const ENTITY_LINK_FOR_EMBED = ENTITY_LINK_ENDPOINT;
    const EMBED_CODE_ENDPOINT = 'https://achordion.xyz/api/embed-code';
    const fetchEmbedCode = async function (track, opts) {
      opts = opts || {};
      const entity = opts.entity || 'track';
      let mbid = track && track.mbid && /^[a-f0-9-]{36}$/i.test(track.mbid) ? track.mbid : null;
      if (!mbid && (entity === 'track' || entity === 'recording')) {
        mbid = await resolveMbid(track);
      }
      if (!mbid) return { ok: false, reason: 'no-mbid' };
      const params = ['entity=' + encodeURIComponent(entity), 'mbid=' + encodeURIComponent(mbid)];
      if (typeof opts.width === 'number') params.push('width=' + opts.width);
      if (typeof opts.height === 'number') params.push('height=' + opts.height);
      const url = EMBED_CODE_ENDPOINT + '?' + params.join('&');
      try {
        const res = await fetch(url, {
          headers: {
            Authorization: 'Bearer ' + BEARER_TOKEN,
            'X-Parachord-Client':
              (typeof window !== 'undefined' && window.__parachordClient) || 'unknown',
          },
        });
        if (!res.ok) {
          console.warn('[achordion] embed-code returned HTTP', res.status, 'for', mbid);
          return { ok: false, reason: 'status-' + res.status, mbid: mbid };
        }
        const data = await res.json();
        console.log('[achordion] embed-code resolved:', mbid);
        return {
          ok: true,
          mbid: mbid,
          html: data.html,
          embedUrl: data.embed_url,
          pageUrl: data.page_url,
          width: data.width,
          height: data.height,
        };
      } catch (e) {
        console.warn('[achordion] embed-code error:', e && e.message ? e.message : e);
        return {
          ok: false,
          reason: 'network',
          message: e && e.message ? e.message : String(e),
          mbid: mbid,
        };
      }
    };
    window.achordion = window.achordion || {};
    window.achordion.submitNow = function (track) {
      return submit('share-trigger', track);
    };
    window.achordion.fetchEntityLink = fetchEntityLink;
    window.achordion.fetchEmbedCode = fetchEmbedCode;
    if (window.scrobbleManager && typeof window.scrobbleManager.registerPlugin === 'function') {
      window.scrobbleManager.registerPlugin({
        id: 'achordion',
        isEnabled: async function () {
          return true;
        },
        updateNowPlaying: async function (track) {
          const conf = playedSourceConfidence(track);
          if (conf >= 1.0) {
            await submit('tier-1', track);
          } else {
            console.log(
              '[achordion] tier-1 not eligible (played-source confidence ' +
                conf.toFixed(2) +
                ' < 1.0):',
              trackLabel(track),
            );
          }
        },
        scrobble: async function (track) {
          const conf = playedSourceConfidence(track);
          if (conf >= 0.95 && conf < 1.0) {
            await submit('tier-2', track);
          } else if (conf >= 1.0) {
            console.log(
              '[achordion] tier-2 skipped (already covered by tier-1):',
              trackLabel(track),
            );
          } else {
            console.log(
              '[achordion] tier-2 not eligible (played-source confidence ' +
                conf.toFixed(2) +
                ' < 0.95):',
              trackLabel(track),
            );
          }
        },
      });
      console.log(
        '[achordion] registered with scrobbleManager (tier-1: now-playing for direct-ID; tier-2: scrobble for fuzzy 0.95; submits all sources at >=' +
          PER_SOURCE_MIN_CONFIDENCE +
          ' confidence; window.achordion.{submitNow,fetchEntityLink,fetchEmbedCode} exposed)',
      );
    } else {
      console.warn(
        '[achordion] scrobbleManager not available — playback-telemetry idle (window.achordion.{submitNow,fetchEntityLink} still exposed)',
      );
    }
    return true;
  },
  // Links to achordion.xyz (#1493; their types are the manifest's urlTypes):
  // a song, an album or a playlist someone shared, dropped on the player or
  // the queue (or opened any other way the app opens a service link). Achordion pages are MusicBrainz entities, so a
  // link names a recording, a release group or a ListenBrainz playlist, by
  // MBID or (Parachord's own fallback links) by artist and title. The app
  // then finds each track on the listener's own services. MusicBrainz
  // requests go through the renderer's MusicBrainz limiter (its fetch
  // interceptor), so these are plain fetches.
  lookupUrl: async function (url) {
    const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let u;
    try { u = new URL(url); } catch (e) { return null; }
    const parts = u.pathname.split('/').filter(Boolean);
    if ((parts[0] || '').toLowerCase() !== 'recording') return null;
    if (parts[1] === 'lookup') {
      const artist = (u.searchParams.get('artist') || '').trim();
      const title = (u.searchParams.get('title') || '').trim();
      if (!artist || !title) return null;
      return { title, artist, album: (u.searchParams.get('album') || '').trim() };
    }
    if (!MBID.test(parts[1] || '')) return null;
    const res = await fetch(`https://musicbrainz.org/ws/2/recording/${parts[1]}?inc=artist-credits+releases&fmt=json`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`MusicBrainz answered ${res.status}`);
    const rec = await res.json();
    const artist = (rec['artist-credit'] || []).map((c) => (c.name || (c.artist && c.artist.name) || '') + (c.joinphrase || '')).join('').trim();
    if (!rec.title || !artist) return null;
    const release = (rec.releases || [])[0];
    return {
      title: rec.title,
      artist,
      album: release ? release.title : '',
      duration: rec.length ? Math.round(rec.length / 1000) : null,
      mbid: rec.id,
    };
  },
  lookupAlbum: async function (url) {
    const MBID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const MB = 'https://musicbrainz.org/ws/2';
    const get = async (path) => {
      const res = await fetch(`${MB}/${path}`, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(`MusicBrainz answered ${res.status}`);
      return res.json();
    };
    const credit = (ac) => (ac || []).map((c) => (c.name || (c.artist && c.artist.name) || '') + (c.joinphrase || '')).join('').trim();
    let u;
    try { u = new URL(url); } catch (e) { return null; }
    const parts = u.pathname.split('/').filter(Boolean);
    if ((parts[0] || '').toLowerCase() !== 'release-group') return null;
    let rgid = parts[1];
    if (rgid === 'lookup') {
      const artist = (u.searchParams.get('artist') || '').trim();
      const title = (u.searchParams.get('title') || '').trim();
      if (!artist || !title) return null;
      const q = `releasegroup:"${title.replace(/"/g, '')}" AND artist:"${artist.replace(/"/g, '')}"`;
      const found = await get(`release-group?query=${encodeURIComponent(q)}&limit=1&fmt=json`);
      rgid = found['release-groups'] && found['release-groups'][0] && found['release-groups'][0].id;
    }
    if (!MBID.test(rgid || '')) return null;
    // The release group's earliest official release stands in for it.
    const group = await get(`release-group/${rgid}?inc=releases+artist-credits&fmt=json`);
    const releases = (group.releases || []).slice().sort((a, b) =>
      ((a.status === 'Official' ? 0 : 1) - (b.status === 'Official' ? 0 : 1)) || String(a.date || '9999').localeCompare(String(b.date || '9999')));
    if (releases.length === 0) return null;
    const release = await get(`release/${releases[0].id}?inc=recordings+artist-credits&fmt=json`);
    const albumArtist = credit(group['artist-credit']) || credit(release['artist-credit']);
    const tracks = [];
    for (const medium of release.media || []) {
      for (const t of medium.tracks || []) {
        tracks.push({
          title: t.title || (t.recording && t.recording.title) || '',
          artist: credit(t['artist-credit'] || (t.recording && t.recording['artist-credit'])) || albumArtist,
          album: group.title,
          duration: t.length ? Math.round(t.length / 1000) : null,
          trackNumber: tracks.length + 1,
          mbid: t.recording && t.recording.id,
        });
      }
    }
    if (tracks.length === 0) return null;
    return {
      id: `achordion-release-group-${rgid}`,
      name: group.title,
      artist: albumArtist,
      albumArt: null,
      releaseDate: group['first-release-date'] || null,
      trackCount: tracks.length,
      tracks,
      url,
    };
  },
  lookupPlaylist: async function (url) {
    let u;
    try { u = new URL(url); } catch (e) { return null; }
    const parts = u.pathname.split('/').filter(Boolean);
    if ((parts[0] || '').toLowerCase() !== 'playlist' || !/^[0-9a-f-]{36}$/i.test(parts[1] || '')) return null;
    const id = parts[1].toLowerCase();
    // Achordion's public XSPF for a ListenBrainz playlist.
    const res = await fetch(`https://achordion.xyz/api/playlist/${id}/xspf`);
    if (!res.ok) throw new Error(`Achordion answered ${res.status}`);
    const doc = new DOMParser().parseFromString(await res.text(), 'application/xml');
    const text = (el, tag) => {
      const n = el.getElementsByTagName(tag)[0];
      return n && n.textContent ? n.textContent.trim() : '';
    };
    const root = doc.getElementsByTagName('playlist')[0];
    if (!root) return null;
    const tracks = Array.from(doc.getElementsByTagName('track')).map((t) => {
      const ms = parseInt(text(t, 'duration'), 10);
      return { title: text(t, 'title'), artist: text(t, 'creator'), album: text(t, 'album'), duration: ms > 0 ? Math.round(ms / 1000) : null };
    }).filter((t) => t.title && t.artist);
    if (tracks.length === 0) return null;
    const titleEl = Array.from(root.childNodes).find((n) => n.nodeName === 'title');
    return { id: `achordion-playlist-${id}`, name: (titleEl && titleEl.textContent.trim()) || 'Playlist', tracks, url };
  },
  cleanup: async function () {
    if (window.scrobbleManager && typeof window.scrobbleManager.unregisterPlugin === 'function') {
      window.scrobbleManager.unregisterPlugin('achordion');
    }
    if (window.achordion) {
      delete window.achordion.submitNow;
      delete window.achordion.fetchEntityLink;
      delete window.achordion.fetchEmbedCode;
    }
    console.log('[achordion] unregistered');
  },
};
