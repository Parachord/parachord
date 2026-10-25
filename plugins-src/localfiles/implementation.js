// Source of truth for plugins/localfiles.axe v1.0.0.
// Imported from the .axe by `node scripts/build-axes.js --import`.
// Edit here, bump manifest.version in manifest.json, then run `node scripts/build-axes.js`.
// The functions materialize fully isolated (resolver-loader.js uses
// new Function) — no shared scope between them; helpers must be embedded per function.
module.exports = {
  search: async function (query, config) {
    if (!window.electron?.localFiles) {
      console.error('Local Files API not available');
      return [];
    }
    try {
      const results = await window.electron.localFiles.search(query);
      return results || [];
    } catch (error) {
      console.error('Local Files search error:', error);
      return [];
    }
  },
  resolve: async function (artist, track, album, config) {
    if (!window.electron?.localFiles) {
      console.error('Local Files API not available');
      return null;
    }
    try {
      console.log('LocalFiles resolver querying:', artist, track, album);
      const results = await window.electron.localFiles.resolve({ artist, track, album });
      console.log('LocalFiles resolver results:', results?.length || 0);
      if (!results || results.length === 0) return null;
      const best = results[0];
      return {
        title: best.title,
        artist: best.artist,
        album: best.album,
        filePath: best.filePath,
        fileUrl: best.sources?.localfiles?.fileUrl || `file://${best.filePath}`,
        confidence: best.confidence || 0.95,
        duration: best.duration,
        albumArt: best.albumArt,
      };
    } catch (error) {
      console.error('Local Files resolve error:', error);
      return null;
    }
  },
  // Album search for the catalog fallback (docs/architecture/plugins.md,
  // "searchAlbums"): albums in the user's own library, which works offline.
  // Matched on the album name; the caller checks the artist. Each result's url
  // is "localfiles:album:<album artist>/<album>", which lookupAlbum accepts.
  searchAlbums: async function (query, config) {
    if (!window.electron?.localFiles?.searchAlbums) return [];
    try {
      const term = typeof query === 'string' ? query : (query && query.title) || '';
      if (!term.trim()) return [];
      const rows = (await window.electron.localFiles.searchAlbums(term.trim())) || [];
      return rows.map((r) => ({
        id: 'localfiles-album-' + encodeURIComponent(r.albumArtist) + '/' + encodeURIComponent(r.album),
        name: r.album,
        artist: r.albumArtist,
        albumArt: null,
        releaseDate: r.year ? String(r.year) : null,
        trackCount: r.trackCount || null,
        url: 'localfiles:album:' + encodeURIComponent(r.albumArtist) + '/' + encodeURIComponent(r.album),
      }));
    } catch (error) {
      console.error('Local Files album search error:', error);
      return [];
    }
  },
  lookupAlbum: async function (url, config) {
    if (!window.electron?.localFiles?.getAlbumTracks) return null;
    try {
      const m = /^localfiles:album:([^/]*)\/(.+)$/.exec(url || '');
      if (!m) return null;
      const albumArtist = decodeURIComponent(m[1]);
      const album = decodeURIComponent(m[2]);
      const rows = (await window.electron.localFiles.getAlbumTracks({ album, albumArtist })) || [];
      if (rows.length === 0) return null;
      const tracks = rows.map((t, i) => ({
        id: t.id,
        title: t.title,
        artist: t.artist,
        album: t.album,
        duration: t.duration,
        filePath: t.filePath,
        fileUrl: t.sources?.localfiles?.fileUrl || `file://${t.filePath}`,
        albumArt: t.albumArt || null,
        trackNumber: t.trackNumber || i + 1,
        discNumber: t.discNumber || 1,
      }));
      return {
        id: 'localfiles-album-' + m[1] + '/' + m[2],
        name: album,
        artist: albumArtist,
        albumArt: tracks.find((t) => t.albumArt)?.albumArt || null,
        releaseDate: rows[0].year ? String(rows[0].year) : null,
        trackCount: tracks.length,
        tracks,
        url,
      };
    } catch (error) {
      console.error('Local Files album lookup error:', error);
      return null;
    }
  },
  play: async function (track, config) {
    console.log('Local Files play:', track);
    return { type: 'local', url: track.fileUrl || track.filePath };
  },
  init: async function (config) {
    console.log('Local Files resolver initialized');
    return true;
  },
  cleanup: async function () {
    console.log('Local Files resolver cleanup');
  },
};
