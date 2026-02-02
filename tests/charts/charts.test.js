/**
 * Charts Tests
 * Tests for chart parsing, filtering, and URL building utilities
 */

const {
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
} = require('../../src/charts-utils');

// Mock Apple Music albums response
const mockAppleMusicAlbumsResponse = {
  feed: {
    title: 'Top Albums',
    country: 'us',
    results: [
      {
        name: 'Midnights',
        artistName: 'Taylor Swift',
        artworkUrl100: 'https://example.com/artwork/100x100bb.jpg',
        url: 'https://music.apple.com/album/midnights',
        genres: [{ name: 'Pop' }, { name: 'Music' }],
        releaseDate: '2022-10-21'
      },
      {
        name: 'Renaissance',
        artistName: 'Beyonce',
        artworkUrl100: 'https://example.com/artwork2/100x100bb.jpg',
        url: 'https://music.apple.com/album/renaissance',
        genres: [{ name: 'R&B/Soul' }, { name: 'Dance' }],
        releaseDate: '2022-07-29'
      },
      {
        name: 'Un Verano Sin Ti',
        artistName: 'Bad Bunny',
        artworkUrl100: '',
        url: 'https://music.apple.com/album/unverano',
        genres: [{ name: 'Latin' }],
        releaseDate: '2022-05-06'
      }
    ]
  }
};

// Mock Apple Music songs response
const mockAppleMusicSongsResponse = {
  feed: {
    title: 'Top Songs',
    country: 'gb',
    results: [
      {
        name: 'Anti-Hero',
        artistName: 'Taylor Swift',
        artworkUrl100: 'https://example.com/song1/100x100.jpg',
        url: 'https://music.apple.com/song/anti-hero',
        genres: [{ name: 'Pop' }, { name: 'Music' }],
        releaseDate: '2022-10-21'
      },
      {
        name: 'Unholy',
        artistName: 'Sam Smith & Kim Petras',
        artworkUrl100: 'https://example.com/song2/100x100.jpg',
        url: 'https://music.apple.com/song/unholy',
        genres: [{ name: 'Pop' }],
        releaseDate: '2022-09-22'
      }
    ]
  }
};

// Mock Last.fm global charts response (chart.gettoptracks)
const mockLastfmGlobalChartsResponse = {
  tracks: {
    track: [
      {
        name: 'Blinding Lights',
        artist: { name: 'The Weeknd' },
        playcount: '5000000',
        listeners: '2000000',
        url: 'https://www.last.fm/music/The+Weeknd/_/Blinding+Lights',
        image: [
          { '#text': 'https://example.com/small.jpg', size: 'small' },
          { '#text': 'https://example.com/large.jpg', size: 'extralarge' }
        ]
      },
      {
        name: 'Bohemian Rhapsody',
        artist: { name: 'Queen' },
        playcount: '4500000',
        listeners: '1800000',
        url: 'https://www.last.fm/music/Queen/_/Bohemian+Rhapsody',
        image: []
      }
    ]
  }
};

// Mock Last.fm country charts response (geo.gettoptracks)
const mockLastfmCountryChartsResponse = {
  toptracks: {
    track: [
      {
        name: 'Running Up That Hill',
        artist: 'Kate Bush',
        playcount: '3000000',
        listeners: '1500000',
        url: 'https://www.last.fm/music/Kate+Bush/_/Running+Up+That+Hill'
      },
      {
        name: 'As It Was',
        artist: 'Harry Styles',
        playcount: '2800000',
        listeners: '1400000',
        url: 'https://www.last.fm/music/Harry+Styles/_/As+It+Was'
      }
    ]
  }
};


describe('Charts Utilities', () => {

  describe('CHARTS_COUNTRIES', () => {
    test('contains expected countries', () => {
      expect(CHARTS_COUNTRIES).toHaveLength(15);
      expect(CHARTS_COUNTRIES.map(c => c.code)).toContain('us');
      expect(CHARTS_COUNTRIES.map(c => c.code)).toContain('gb');
      expect(CHARTS_COUNTRIES.map(c => c.code)).toContain('jp');
    });

    test('each country has required fields', () => {
      CHARTS_COUNTRIES.forEach(country => {
        expect(country).toHaveProperty('code');
        expect(country).toHaveProperty('name');
        expect(country).toHaveProperty('lastfmName');
        expect(country.code).toHaveLength(2);
      });
    });

    test('country codes are lowercase', () => {
      CHARTS_COUNTRIES.forEach(country => {
        expect(country.code).toBe(country.code.toLowerCase());
      });
    });
  });


  describe('parseAppleMusicAlbumsJSON', () => {
    test('parses valid album data correctly', () => {
      const albums = parseAppleMusicAlbumsJSON(mockAppleMusicAlbumsResponse);

      expect(albums).toHaveLength(3);

      // First album
      expect(albums[0].title).toBe('Midnights');
      expect(albums[0].artist).toBe('Taylor Swift');
      expect(albums[0].rank).toBe(1);
      expect(albums[0].genres).toEqual(['Pop']); // 'Music' filtered out
      expect(albums[0].link).toBe('https://music.apple.com/album/midnights');
      expect(albums[0].albumArt).toBe('https://example.com/artwork/300x300bb.jpg');
      expect(albums[0].pubDate).toBeInstanceOf(Date);
    });

    test('generates unique IDs', () => {
      const albums = parseAppleMusicAlbumsJSON(mockAppleMusicAlbumsResponse);
      const ids = albums.map(a => a.id);
      const uniqueIds = new Set(ids);

      expect(uniqueIds.size).toBe(albums.length);
    });

    test('assigns correct ranks', () => {
      const albums = parseAppleMusicAlbumsJSON(mockAppleMusicAlbumsResponse);

      expect(albums[0].rank).toBe(1);
      expect(albums[1].rank).toBe(2);
      expect(albums[2].rank).toBe(3);
    });

    test('handles missing artwork URL', () => {
      const albums = parseAppleMusicAlbumsJSON(mockAppleMusicAlbumsResponse);

      // Third album has empty artworkUrl100
      expect(albums[2].albumArt).toBeNull();
    });

    test('handles empty response', () => {
      const albums = parseAppleMusicAlbumsJSON({ feed: { results: [] } });
      expect(albums).toEqual([]);
    });

    test('handles null/undefined data', () => {
      expect(parseAppleMusicAlbumsJSON(null)).toEqual([]);
      expect(parseAppleMusicAlbumsJSON(undefined)).toEqual([]);
      expect(parseAppleMusicAlbumsJSON({})).toEqual([]);
    });

    test('filters out items without album or artist', () => {
      const dataWithInvalid = {
        feed: {
          results: [
            { name: 'Valid Album', artistName: 'Valid Artist' },
            { name: '', artistName: 'Artist Only' },
            { name: 'Album Only', artistName: '' },
            { artistName: 'Missing Name' }
          ]
        }
      };

      const albums = parseAppleMusicAlbumsJSON(dataWithInvalid);
      expect(albums).toHaveLength(1);
      expect(albums[0].title).toBe('Valid Album');
    });

    test('sanitizes ID to only contain valid characters', () => {
      const dataWithSpecialChars = {
        feed: {
          results: [
            { name: 'Album (Deluxe) [Special]', artistName: 'Artist & Friends' }
          ]
        }
      };

      const albums = parseAppleMusicAlbumsJSON(dataWithSpecialChars);
      expect(albums[0].id).toMatch(/^[a-z0-9-]+$/);
    });
  });


  describe('parseAppleMusicSongsJSON', () => {
    test('parses valid song data correctly', () => {
      const songs = parseAppleMusicSongsJSON(mockAppleMusicSongsResponse, 'gb');

      expect(songs).toHaveLength(2);

      // First song
      expect(songs[0].title).toBe('Anti-Hero');
      expect(songs[0].artist).toBe('Taylor Swift');
      expect(songs[0].rank).toBe(1);
      expect(songs[0].source).toBe('apple');
      expect(songs[0].album).toBe(''); // Songs don't include album
      expect(songs[0].genres).toEqual(['Pop']); // 'Music' filtered out
    });

    test('includes country code in ID', () => {
      const songsUS = parseAppleMusicSongsJSON(mockAppleMusicSongsResponse, 'us');
      const songsGB = parseAppleMusicSongsJSON(mockAppleMusicSongsResponse, 'gb');

      expect(songsUS[0].id).toContain('us');
      expect(songsGB[0].id).toContain('gb');
    });

    test('defaults to us country code', () => {
      const songs = parseAppleMusicSongsJSON(mockAppleMusicSongsResponse);
      expect(songs[0].id).toContain('us');
    });

    test('upgrades artwork URL resolution', () => {
      const songs = parseAppleMusicSongsJSON(mockAppleMusicSongsResponse);
      expect(songs[0].albumArt).toBe('https://example.com/song1/600x600.jpg');
    });

    test('handles empty response', () => {
      const songs = parseAppleMusicSongsJSON({ feed: { results: [] } });
      expect(songs).toEqual([]);
    });

    test('handles missing artist name', () => {
      const dataWithMissingArtist = {
        feed: {
          results: [{ name: 'Song Title' }]
        }
      };

      const songs = parseAppleMusicSongsJSON(dataWithMissingArtist);
      expect(songs[0].artist).toBe('Unknown Artist');
    });
  });


  describe('parseLastfmChartsJSON', () => {
    test('parses global charts response (tracks.track)', () => {
      const tracks = parseLastfmChartsJSON(mockLastfmGlobalChartsResponse);

      expect(tracks).toHaveLength(2);

      // First track
      expect(tracks[0].title).toBe('Blinding Lights');
      expect(tracks[0].artist).toBe('The Weeknd');
      expect(tracks[0].rank).toBe(1);
      expect(tracks[0].playcount).toBe(5000000);
      expect(tracks[0].listeners).toBe(2000000);
      expect(tracks[0].source).toBe('lastfm');
      expect(tracks[0].albumArt).toBe('https://example.com/large.jpg');
    });

    test('parses country charts response (toptracks.track)', () => {
      const tracks = parseLastfmChartsJSON(mockLastfmCountryChartsResponse);

      expect(tracks).toHaveLength(2);

      // First track - artist is string instead of object
      expect(tracks[0].title).toBe('Running Up That Hill');
      expect(tracks[0].artist).toBe('Kate Bush');
    });

    test('handles artist as string (geo.gettoptracks format)', () => {
      const tracks = parseLastfmChartsJSON(mockLastfmCountryChartsResponse);
      expect(tracks[0].artist).toBe('Kate Bush');
    });

    test('handles artist as object (chart.gettoptracks format)', () => {
      const tracks = parseLastfmChartsJSON(mockLastfmGlobalChartsResponse);
      expect(tracks[0].artist).toBe('The Weeknd');
    });

    test('handles missing album art', () => {
      const tracks = parseLastfmChartsJSON(mockLastfmGlobalChartsResponse);
      expect(tracks[1].albumArt).toBeNull(); // Queen track has empty image array
    });

    test('handles empty response', () => {
      expect(parseLastfmChartsJSON({})).toEqual([]);
      expect(parseLastfmChartsJSON({ tracks: {} })).toEqual([]);
      expect(parseLastfmChartsJSON({ toptracks: {} })).toEqual([]);
    });

    test('parses playcount and listeners as numbers', () => {
      const tracks = parseLastfmChartsJSON(mockLastfmGlobalChartsResponse);
      expect(typeof tracks[0].playcount).toBe('number');
      expect(typeof tracks[0].listeners).toBe('number');
    });
  });


  describe('filterCharts', () => {
    const mockItems = [
      { title: 'Midnights', artist: 'Taylor Swift' },
      { title: 'Renaissance', artist: 'Beyonce' },
      { title: 'Un Verano Sin Ti', artist: 'Bad Bunny' },
      { title: 'Harry\'s House', artist: 'Harry Styles' }
    ];

    test('filters by title', () => {
      const filtered = filterCharts(mockItems, 'midnight');
      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('Midnights');
    });

    test('filters by artist', () => {
      const filtered = filterCharts(mockItems, 'beyonce');
      expect(filtered).toHaveLength(1);
      expect(filtered[0].artist).toBe('Beyonce');
    });

    test('is case insensitive', () => {
      expect(filterCharts(mockItems, 'TAYLOR')).toHaveLength(1);
      expect(filterCharts(mockItems, 'taylor')).toHaveLength(1);
      expect(filterCharts(mockItems, 'TaYlOr')).toHaveLength(1);
    });

    test('returns all items when query is empty', () => {
      expect(filterCharts(mockItems, '')).toHaveLength(4);
      expect(filterCharts(mockItems, '   ')).toHaveLength(4);
      expect(filterCharts(mockItems, null)).toHaveLength(4);
      expect(filterCharts(mockItems, undefined)).toHaveLength(4);
    });

    test('returns empty array when no matches', () => {
      const filtered = filterCharts(mockItems, 'nonexistent');
      expect(filtered).toEqual([]);
    });

    test('matches partial strings', () => {
      const filtered = filterCharts(mockItems, 'har');
      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe('Harry\'s House');
    });

    test('can match multiple items', () => {
      // Both have 's' in their names
      const filtered = filterCharts(mockItems, 'house');
      expect(filtered).toHaveLength(1);
    });
  });


  describe('buildAppleMusicAlbumsURL', () => {
    test('builds URL with default parameters', () => {
      const url = buildAppleMusicAlbumsURL();
      expect(url).toBe('https://rss.marketingtools.apple.com/api/v2/us/music/most-played/50/albums.json');
    });

    test('builds URL with custom country', () => {
      const url = buildAppleMusicAlbumsURL('gb');
      expect(url).toContain('/gb/');
    });

    test('builds URL with custom limit', () => {
      const url = buildAppleMusicAlbumsURL('us', 100);
      expect(url).toContain('/100/');
    });
  });


  describe('buildAppleMusicSongsURL', () => {
    test('builds URL with default parameters', () => {
      const url = buildAppleMusicSongsURL();
      expect(url).toBe('https://rss.marketingtools.apple.com/api/v2/us/music/most-played/50/songs.json');
    });

    test('builds URL with custom country', () => {
      const url = buildAppleMusicSongsURL('jp');
      expect(url).toContain('/jp/');
    });

    test('builds URL with custom limit', () => {
      const url = buildAppleMusicSongsURL('us', 25);
      expect(url).toContain('/25/');
    });
  });


  describe('buildLastfmChartsURL', () => {
    const mockApiKey = 'test-api-key-12345';

    test('builds global charts URL when no country specified', () => {
      const url = buildLastfmChartsURL(mockApiKey);
      expect(url).toContain('method=chart.gettoptracks');
      expect(url).toContain(`api_key=${mockApiKey}`);
      expect(url).toContain('format=json');
      expect(url).toContain('limit=50');
    });

    test('builds country charts URL when country specified', () => {
      const url = buildLastfmChartsURL(mockApiKey, 'gb');
      expect(url).toContain('method=geo.gettoptracks');
      expect(url).toContain('country=United+Kingdom');
      expect(url).toContain(`api_key=${mockApiKey}`);
    });

    test('uses lastfmName for country parameter', () => {
      const url = buildLastfmChartsURL(mockApiKey, 'kr');
      expect(url).toContain('country=South+Korea');
    });

    test('defaults to United States for unknown country code', () => {
      const url = buildLastfmChartsURL(mockApiKey, 'xx');
      expect(url).toContain('country=United+States');
    });

    test('respects custom limit', () => {
      const url = buildLastfmChartsURL(mockApiKey, null, 100);
      expect(url).toContain('limit=100');
    });
  });


  describe('getCountryByCode', () => {
    test('returns country for valid code', () => {
      const country = getCountryByCode('us');
      expect(country).toBeDefined();
      expect(country.name).toBe('United States');
      expect(country.lastfmName).toBe('United States');
    });

    test('returns undefined for invalid code', () => {
      expect(getCountryByCode('xx')).toBeUndefined();
      expect(getCountryByCode('')).toBeUndefined();
      expect(getCountryByCode(null)).toBeUndefined();
    });

    test('is case sensitive (expects lowercase)', () => {
      expect(getCountryByCode('US')).toBeUndefined();
      expect(getCountryByCode('us')).toBeDefined();
    });
  });


  describe('isValidCountryCode', () => {
    test('returns true for valid codes', () => {
      expect(isValidCountryCode('us')).toBe(true);
      expect(isValidCountryCode('gb')).toBe(true);
      expect(isValidCountryCode('jp')).toBe(true);
    });

    test('returns false for invalid codes', () => {
      expect(isValidCountryCode('xx')).toBe(false);
      expect(isValidCountryCode('')).toBe(false);
      expect(isValidCountryCode(null)).toBe(false);
      expect(isValidCountryCode(undefined)).toBe(false);
    });

    test('is case sensitive', () => {
      expect(isValidCountryCode('US')).toBe(false);
      expect(isValidCountryCode('us')).toBe(true);
    });
  });
});
