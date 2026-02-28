class PlaylistService {
  constructor(store, wsManager) {
    this.store = store;
    this.wsManager = wsManager;
  }

  /**
   * Get all playlists, sorted by addedAt descending
   */
  getAll() {
    const playlists = this.store.get('local_playlists', []);
    playlists.sort((a, b) => {
      const aTime = Number(a.addedAt) || Number(a.lastModified) || Number(a.createdAt) || 0;
      const bTime = Number(b.addedAt) || Number(b.lastModified) || Number(b.createdAt) || 0;
      return bTime - aTime;
    });
    return playlists;
  }

  /**
   * Get a single playlist by ID
   */
  getById(id) {
    const playlists = this.store.get('local_playlists', []);
    return playlists.find(p => p.id === id) || null;
  }

  /**
   * Create or update a playlist
   */
  save(playlistData) {
    if (!playlistData || !playlistData.id) {
      throw new Error('Playlist must have an id');
    }

    const playlists = this.store.get('local_playlists', []);
    const existingIndex = playlists.findIndex(p => p.id === playlistData.id);

    if (existingIndex >= 0) {
      playlists[existingIndex] = playlistData;
    } else {
      playlists.push(playlistData);
    }

    this.store.set('local_playlists', playlists);
    this.wsManager.broadcast('playlists:updated', this.getAll());
    return { success: true };
  }

  /**
   * Delete a playlist
   */
  delete(id) {
    const playlists = this.store.get('local_playlists', []);
    const filtered = playlists.filter(p => p.id !== id);

    if (filtered.length === playlists.length) {
      throw new Error('Playlist not found');
    }

    this.store.set('local_playlists', filtered);
    this.wsManager.broadcast('playlists:updated', this.getAll());
    return { success: true };
  }

  /**
   * Import from XSPF content string
   * Returns parsed playlist object for the caller to save
   */
  parseXspf(content, filename) {
    if (!content.includes('<playlist') || !content.includes('</playlist>')) {
      throw new Error('Not a valid XSPF playlist file');
    }
    return { content, filename };
  }

  /**
   * Export a playlist to XSPF format
   */
  exportXspf(id) {
    const playlist = this.getById(id);
    if (!playlist) throw new Error('Playlist not found');

    const tracks = (playlist.tracks || []).map(t =>
      `    <track>
      <title>${escapeXml(t.title || '')}</title>
      <creator>${escapeXml(t.artist || '')}</creator>
      <album>${escapeXml(t.album || '')}</album>
      ${t.duration ? `<duration>${Math.round(t.duration * 1000)}</duration>` : ''}
    </track>`
    ).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<playlist version="1" xmlns="http://xspf.org/ns/0/">
  <title>${escapeXml(playlist.name || 'Untitled')}</title>
  <trackList>
${tracks}
  </trackList>
</playlist>`;
  }
}

function escapeXml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

module.exports = PlaylistService;
