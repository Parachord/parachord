/**
 * @typedef {Object} SyncProviderCapabilities
 * @property {boolean} tracks - Can sync liked/saved songs
 * @property {boolean} albums - Can sync saved albums
 * @property {boolean} artists - Can sync followed artists
 * @property {boolean} playlists - Can sync user playlists
 * @property {boolean} playlistFolders - Supports hierarchical playlist organization
 */

/**
 * @typedef {Object} SyncTrack
 * @property {string} id - Unique identifier (artist-title-album normalized)
 * @property {string} externalId - ID in the source service
 * @property {string} title - Track title
 * @property {string} artist - Artist name
 * @property {string} album - Album name
 * @property {number} duration - Duration in seconds
 * @property {string} [albumArt] - Album art URL
 * @property {number} addedAt - When added to source library (timestamp)
 */

/**
 * @typedef {Object} SyncAlbum
 * @property {string} id - Unique identifier
 * @property {string} externalId - ID in the source service
 * @property {string} title - Album title
 * @property {string} artist - Artist name
 * @property {number} [year] - Release year
 * @property {string} [art] - Album art URL
 * @property {number} addedAt - When added to source library
 */

/**
 * @typedef {Object} SyncArtist
 * @property {string} id - Unique identifier
 * @property {string} externalId - ID in the source service
 * @property {string} name - Artist name
 * @property {string} [image] - Artist image URL
 * @property {number} addedAt - When followed
 */

/**
 * @typedef {Object} SyncPlaylist
 * @property {string} id - Unique identifier
 * @property {string} externalId - ID in the source service
 * @property {string} name - Playlist name
 * @property {string} [description] - Playlist description
 * @property {string} [image] - Playlist cover image
 * @property {number} trackCount - Number of tracks
 * @property {string} [snapshotId] - Version identifier for change detection
 * @property {string} [folderId] - Parent folder ID if in a folder
 * @property {string} [folderName] - Parent folder name
 * @property {boolean} isOwnedByUser - Whether user created this playlist
 */

/**
 * @typedef {Object} SyncPlaylistFolder
 * @property {string} id - Folder ID
 * @property {string} name - Folder name
 * @property {string[]} playlistIds - IDs of playlists in this folder
 */

/**
 * @typedef {Object} SyncProgress
 * @property {string} phase - Current phase: 'fetching' | 'processing' | 'saving' | 'complete' | 'error'
 * @property {string} type - What's being synced: 'tracks' | 'albums' | 'artists' | 'playlists'
 * @property {number} current - Current item number
 * @property {number} total - Total items to process
 * @property {string} [message] - Human-readable status message
 */

/**
 * @typedef {Object} SyncResult
 * @property {boolean} success
 * @property {number} added - Items added
 * @property {number} removed - Items removed
 * @property {number} unchanged - Items unchanged
 * @property {string[]} [errors] - Any errors encountered
 */

/**
 * Interface that sync providers must implement.
 * Each resolver that supports library sync creates a provider.
 *
 * @typedef {Object} SyncProvider
 * @property {string} id - Resolver identifier (e.g., "spotify")
 * @property {string} displayName - Human-readable name for UI
 * @property {SyncProviderCapabilities} capabilities - What this provider can sync
 * @property {function(string): Promise<SyncTrack[]>} fetchTracks - Fetch all liked/saved tracks
 * @property {function(string): Promise<SyncAlbum[]>} fetchAlbums - Fetch all saved albums
 * @property {function(string): Promise<SyncArtist[]>} fetchArtists - Fetch all followed artists
 * @property {function(string): Promise<{playlists: SyncPlaylist[], folders: SyncPlaylistFolder[]}>} fetchPlaylists - Fetch all playlists with folder structure
 * @property {function(string, string): Promise<SyncTrack[]>} fetchPlaylistTracks - Fetch tracks for a specific playlist
 * @property {function(string, string): Promise<string>} getPlaylistSnapshot - Get current snapshot ID for change detection
 * @property {function(): number} getRateLimitDelay - Get delay between API calls in ms
 * @property {function(string): Promise<boolean>} checkAuth - Verify token is valid
 */

module.exports = {
  // Export empty object - types are for JSDoc only
};
