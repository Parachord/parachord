/**
 * Charts Utility Functions
 * Pure functions for parsing and filtering chart data from Apple Music and Last.fm
 */

/**
 * Countries supported for charts with their codes and Last.fm names
 */
const CHARTS_COUNTRIES = [
  { code: 'us', name: 'United States', lastfmName: 'United States' },
  { code: 'gb', name: 'United Kingdom', lastfmName: 'United Kingdom' },
  { code: 'ca', name: 'Canada', lastfmName: 'Canada' },
  { code: 'au', name: 'Australia', lastfmName: 'Australia' },
  { code: 'de', name: 'Germany', lastfmName: 'Germany' },
  { code: 'fr', name: 'France', lastfmName: 'France' },
  { code: 'jp', name: 'Japan', lastfmName: 'Japan' },
  { code: 'kr', name: 'South Korea', lastfmName: 'South Korea' },
  { code: 'br', name: 'Brazil', lastfmName: 'Brazil' },
  { code: 'mx', name: 'Mexico', lastfmName: 'Mexico' },
  { code: 'es', name: 'Spain', lastfmName: 'Spain' },
  { code: 'it', name: 'Italy', lastfmName: 'Italy' },
  { code: 'nl', name: 'Netherlands', lastfmName: 'Netherlands' },
  { code: 'se', name: 'Sweden', lastfmName: 'Sweden' },
  { code: 'pl', name: 'Poland', lastfmName: 'Poland' },
];

/**
 * Parse Apple Music album charts JSON response
 * @param {Object} data - Raw JSON response from Apple Music RSS feed
 * @returns {Array} Parsed album objects
 */
function parseAppleMusicAlbumsJSON(data) {
  try {
    const results = data?.feed?.results || [];
    const albums = [];

    results.forEach((item, index) => {
      const album = item.name || '';
      const artist = item.artistName || '';
      const artworkUrl = item.artworkUrl100 || '';
      const link = item.url || '';
      const genres = (item.genres || [])
        .map(g => g.name)
        .filter(g => g !== 'Music');

      if (album && artist) {
        albums.push({
          id: `charts-${index}-${artist}-${album}`.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
          artist: artist,
          title: album,
          rank: index + 1,
          link: link,
          genres: genres,
          pubDate: item.releaseDate ? new Date(item.releaseDate) : null,
          albumArt: artworkUrl ? artworkUrl.replace('100x100bb', '300x300bb') : null
        });
      }
    });

    return albums;
  } catch (error) {
    console.error('Error parsing Apple Music albums JSON:', error);
    return [];
  }
}

/**
 * Parse Apple Music songs charts JSON response
 * @param {Object} data - Raw JSON response from Apple Music RSS feed
 * @param {string} countryCode - Country code for track IDs
 * @returns {Array} Parsed track objects
 */
function parseAppleMusicSongsJSON(data, countryCode = 'us') {
  try {
    const results = data?.feed?.results || [];

    return results.map((item, index) => ({
      id: `apple-chart-${countryCode}-${index}-${item.name}`.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      title: item.name || '',
      artist: item.artistName || 'Unknown Artist',
      album: '', // Songs endpoint doesn't include album name
      rank: index + 1,
      albumArt: item.artworkUrl100 ? item.artworkUrl100.replace('100x100', '600x600') : null,
      genres: (item.genres || []).map(g => g.name).filter(g => g !== 'Music'),
      url: item.url || '',
      source: 'apple',
      releaseDate: item.releaseDate || null
    }));
  } catch (error) {
    console.error('Error parsing Apple Music songs JSON:', error);
    return [];
  }
}

/**
 * Parse Last.fm charts JSON response
 * @param {Object} data - Raw JSON response from Last.fm API
 * @returns {Array} Parsed track objects
 */
function parseLastfmChartsJSON(data) {
  try {
    // Response structure differs by endpoint (chart.gettoptracks vs geo.gettoptracks)
    const tracks = data.tracks?.track || data.toptracks?.track || [];

    return tracks.map((track, index) => ({
      id: `lastfm-chart-${index}-${track.name}`.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
      title: track.name,
      artist: track.artist?.name || (typeof track.artist === 'string' ? track.artist : 'Unknown Artist'),
      album: '', // Last.fm doesn't include album info in these endpoints
      rank: index + 1,
      playcount: parseInt(track.playcount) || 0,
      listeners: parseInt(track.listeners) || 0,
      url: track.url,
      albumArt: track.image?.find(img => img.size === 'extralarge')?.['#text'] || null,
      source: 'lastfm'
    }));
  } catch (error) {
    console.error('Error parsing Last.fm charts JSON:', error);
    return [];
  }
}

/**
 * Filter charts/tracks by search query
 * @param {Array} items - Array of chart items (albums or tracks)
 * @param {string} searchQuery - Search query string
 * @returns {Array} Filtered items
 */
function filterCharts(items, searchQuery) {
  if (!searchQuery || !searchQuery.trim()) return items;
  const query = searchQuery.toLowerCase();
  return items.filter(c =>
    c.title.toLowerCase().includes(query) ||
    c.artist.toLowerCase().includes(query)
  );
}

/**
 * Build Apple Music RSS feed URL for albums
 * @param {string} countryCode - Two-letter country code
 * @param {number} limit - Number of results (default 50)
 * @returns {string} RSS feed URL
 */
function buildAppleMusicAlbumsURL(countryCode = 'us', limit = 50) {
  return `https://rss.marketingtools.apple.com/api/v2/${countryCode}/music/most-played/${limit}/albums.json`;
}

/**
 * Build Apple Music RSS feed URL for songs
 * @param {string} countryCode - Two-letter country code
 * @param {number} limit - Number of results (default 50)
 * @returns {string} RSS feed URL
 */
function buildAppleMusicSongsURL(countryCode = 'us', limit = 50) {
  return `https://rss.marketingtools.apple.com/api/v2/${countryCode}/music/most-played/${limit}/songs.json`;
}

/**
 * Build Last.fm API URL for charts
 * @param {string} apiKey - Last.fm API key
 * @param {string|null} country - Country code (null for global charts)
 * @param {number} limit - Number of results (default 50)
 * @returns {string} API URL
 */
function buildLastfmChartsURL(apiKey, country = null, limit = 50) {
  if (country) {
    const countryInfo = CHARTS_COUNTRIES.find(c => c.code === country);
    const countryName = countryInfo?.lastfmName || 'United States';
    const params = new URLSearchParams({
      method: 'geo.gettoptracks',
      country: countryName,
      api_key: apiKey,
      format: 'json',
      limit: String(limit)
    });
    return `https://ws.audioscrobbler.com/2.0/?${params}`;
  } else {
    return `https://ws.audioscrobbler.com/2.0/?method=chart.gettoptracks&api_key=${apiKey}&format=json&limit=${limit}`;
  }
}

/**
 * Get country info by code
 * @param {string} code - Two-letter country code
 * @returns {Object|undefined} Country info object
 */
function getCountryByCode(code) {
  return CHARTS_COUNTRIES.find(c => c.code === code);
}

/**
 * Validate country code
 * @param {string} code - Two-letter country code
 * @returns {boolean} Whether the code is valid
 */
function isValidCountryCode(code) {
  return CHARTS_COUNTRIES.some(c => c.code === code);
}

module.exports = {
  CHARTS_COUNTRIES,
  parseAppleMusicAlbumsJSON,
  parseAppleMusicSongsJSON,
  parseLastfmChartsJSON,
  filterCharts,
  buildAppleMusicAlbumsURL,
  buildAppleMusicSongsURL,
  buildLastfmChartsURL,
  getCountryByCode,
  isValidCountryCode
};
