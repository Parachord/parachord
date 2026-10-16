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
