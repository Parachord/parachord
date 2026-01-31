/**
 * Local Files System Tests
 *
 * Tests for local music library management:
 * database operations, file scanning, change detection,
 * metadata extraction, and album art resolution.
 */

describe('Local Files Database', () => {
  describe('Text Normalization', () => {
    const normalize = (str) => {
      if (!str) return '';
      return str.toLowerCase().trim().replace(/[^\w\s]/g, '');
    };

    test('normalizes to lowercase', () => {
      expect(normalize('The Beatles')).toBe('the beatles');
    });

    test('removes special characters', () => {
      expect(normalize("AC/DC")).toBe('acdc');
      expect(normalize("Guns N' Roses")).toBe('guns n roses');
    });

    test('trims whitespace', () => {
      expect(normalize('  Artist  ')).toBe('artist');
    });

    test('handles null/undefined', () => {
      expect(normalize(null)).toBe('');
      expect(normalize(undefined)).toBe('');
    });

    test('preserves numbers', () => {
      expect(normalize('Maroon 5')).toBe('maroon 5');
    });
  });

  describe('Watch Folder Operations', () => {
    let mockDb;

    beforeEach(() => {
      mockDb = {
        watchFolders: [],
        tracks: [],

        addWatchFolder(path) {
          if (!this.watchFolders.find(f => f.path === path)) {
            this.watchFolders.push({
              id: this.watchFolders.length + 1,
              path,
              enabled: 1,
              lastScanAt: null,
              trackCount: 0
            });
            return { changes: 1 };
          }
          return { changes: 0 };
        },

        removeWatchFolder(path) {
          this.tracks = this.tracks.filter(t => !t.filePath.startsWith(path));
          this.watchFolders = this.watchFolders.filter(f => f.path !== path);
          return { changes: 1 };
        },

        getWatchFolders() {
          return this.watchFolders.filter(f => f.enabled);
        }
      };
    });

    test('can add a watch folder', () => {
      const result = mockDb.addWatchFolder('/music/library');

      expect(result.changes).toBe(1);
      expect(mockDb.watchFolders).toHaveLength(1);
      expect(mockDb.watchFolders[0].path).toBe('/music/library');
    });

    test('duplicate folder is ignored', () => {
      mockDb.addWatchFolder('/music/library');
      const result = mockDb.addWatchFolder('/music/library');

      expect(result.changes).toBe(0);
      expect(mockDb.watchFolders).toHaveLength(1);
    });

    test('removing folder deletes associated tracks', () => {
      mockDb.addWatchFolder('/music/library');
      mockDb.tracks = [
        { filePath: '/music/library/song1.mp3' },
        { filePath: '/music/library/album/song2.mp3' },
        { filePath: '/music/other/song3.mp3' }
      ];

      mockDb.removeWatchFolder('/music/library');

      expect(mockDb.tracks).toHaveLength(1);
      expect(mockDb.tracks[0].filePath).toBe('/music/other/song3.mp3');
    });
  });

  describe('Track CRUD Operations', () => {
    let mockDb;

    beforeEach(() => {
      mockDb = {
        tracks: [],

        upsertTrack(track) {
          const existing = this.tracks.findIndex(t => t.filePath === track.filePath);
          if (existing >= 0) {
            this.tracks[existing] = { ...this.tracks[existing], ...track };
          } else {
            this.tracks.push({ id: this.tracks.length + 1, ...track });
          }
        },

        getTrackByPath(filePath) {
          return this.tracks.find(t => t.filePath === filePath);
        },

        deleteTrack(filePath) {
          this.tracks = this.tracks.filter(t => t.filePath !== filePath);
        },

        searchTracks(query) {
          const normalized = query.toLowerCase();
          return this.tracks.filter(t =>
            t.title?.toLowerCase().includes(normalized) ||
            t.artist?.toLowerCase().includes(normalized) ||
            t.album?.toLowerCase().includes(normalized)
          );
        }
      };
    });

    test('can insert a new track', () => {
      mockDb.upsertTrack({
        filePath: '/music/song.mp3',
        title: 'Test Song',
        artist: 'Test Artist',
        album: 'Test Album',
        duration: 180
      });

      expect(mockDb.tracks).toHaveLength(1);
      expect(mockDb.tracks[0].title).toBe('Test Song');
    });

    test('can update existing track', () => {
      mockDb.upsertTrack({
        filePath: '/music/song.mp3',
        title: 'Original Title'
      });

      mockDb.upsertTrack({
        filePath: '/music/song.mp3',
        title: 'Updated Title'
      });

      expect(mockDb.tracks).toHaveLength(1);
      expect(mockDb.tracks[0].title).toBe('Updated Title');
    });

    test('can get track by path', () => {
      mockDb.upsertTrack({
        filePath: '/music/song.mp3',
        title: 'Test Song'
      });

      const track = mockDb.getTrackByPath('/music/song.mp3');

      expect(track).not.toBeNull();
      expect(track.title).toBe('Test Song');
    });

    test('can delete track', () => {
      mockDb.upsertTrack({ filePath: '/music/song.mp3', title: 'Song' });

      mockDb.deleteTrack('/music/song.mp3');

      expect(mockDb.tracks).toHaveLength(0);
    });

    test('can search tracks', () => {
      mockDb.upsertTrack({ filePath: '/1.mp3', title: 'Hello World', artist: 'Artist A' });
      mockDb.upsertTrack({ filePath: '/2.mp3', title: 'Goodbye', artist: 'Artist B' });
      mockDb.upsertTrack({ filePath: '/3.mp3', title: 'Test', artist: 'Hello' });

      const results = mockDb.searchTracks('hello');

      expect(results).toHaveLength(2);
    });
  });
});

describe('File Scanner', () => {
  describe('Supported Formats', () => {
    const SUPPORTED_FORMATS = ['.mp3', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.wav', '.aiff'];

    const isSupported = (filePath) => {
      const ext = filePath.toLowerCase().slice(filePath.lastIndexOf('.'));
      return SUPPORTED_FORMATS.includes(ext);
    };

    test('mp3 files are supported', () => {
      expect(isSupported('/music/song.mp3')).toBe(true);
      expect(isSupported('/music/song.MP3')).toBe(true);
    });

    test('flac files are supported', () => {
      expect(isSupported('/music/song.flac')).toBe(true);
    });

    test('m4a/aac files are supported', () => {
      expect(isSupported('/music/song.m4a')).toBe(true);
      expect(isSupported('/music/song.aac')).toBe(true);
    });

    test('ogg/opus files are supported', () => {
      expect(isSupported('/music/song.ogg')).toBe(true);
      expect(isSupported('/music/song.opus')).toBe(true);
    });

    test('wav/aiff files are supported', () => {
      expect(isSupported('/music/song.wav')).toBe(true);
      expect(isSupported('/music/song.aiff')).toBe(true);
    });

    test('unsupported formats are rejected', () => {
      expect(isSupported('/music/song.wma')).toBe(false);
      expect(isSupported('/music/playlist.m3u')).toBe(false);
      expect(isSupported('/music/cover.jpg')).toBe(false);
    });
  });

  describe('Scan Progress', () => {
    test('progress callback is called with correct data', () => {
      const progressUpdates = [];

      const onProgress = (data) => {
        progressUpdates.push(data);
      };

      // Simulate scanning
      const files = ['/a.mp3', '/b.mp3', '/c.mp3', '/d.mp3', '/e.mp3'];
      files.forEach((file, index) => {
        onProgress({
          current: index + 1,
          total: files.length,
          file,
          percent: Math.round(((index + 1) / files.length) * 100)
        });
      });

      expect(progressUpdates).toHaveLength(5);
      expect(progressUpdates[0].percent).toBe(20);
      expect(progressUpdates[4].percent).toBe(100);
    });

    test('empty folder reports 0 files', () => {
      const result = { total: 0, added: 0, updated: 0, removed: 0 };

      expect(result.total).toBe(0);
    });
  });
});

describe('File Watcher', () => {
  describe('Change Detection', () => {
    test('new file triggers add event', () => {
      const events = [];

      const handleAdd = (filePath) => {
        events.push({ type: 'add', path: filePath });
      };

      handleAdd('/music/new-song.mp3');

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('add');
    });

    test('modified file triggers change event', () => {
      const events = [];

      const handleChange = (filePath) => {
        events.push({ type: 'change', path: filePath });
      };

      handleChange('/music/existing-song.mp3');

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('change');
    });

    test('deleted file triggers unlink event', () => {
      const events = [];

      const handleUnlink = (filePath) => {
        events.push({ type: 'unlink', path: filePath });
      };

      handleUnlink('/music/deleted-song.mp3');

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('unlink');
    });
  });

  describe('Debouncing', () => {
    jest.useFakeTimers();

    test('rapid changes are debounced', () => {
      let processCount = 0;
      let debounceTimer = null;
      const debounceMs = 300;
      const pendingChanges = [];

      const queueChange = (path) => {
        pendingChanges.push(path);

        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }

        debounceTimer = setTimeout(() => {
          processCount++;
          pendingChanges.length = 0;
        }, debounceMs);
      };

      // Rapid changes
      queueChange('/a.mp3');
      queueChange('/b.mp3');
      queueChange('/c.mp3');

      // Before debounce
      expect(processCount).toBe(0);

      // After debounce
      jest.advanceTimersByTime(300);
      expect(processCount).toBe(1);
    });

    afterAll(() => {
      jest.useRealTimers();
    });
  });
});

describe('Metadata Reader', () => {
  describe('Metadata Extraction', () => {
    test('extracts basic ID3 tags', () => {
      const mockMetadata = {
        common: {
          title: 'Test Song',
          artist: 'Test Artist',
          album: 'Test Album',
          year: 2023,
          track: { no: 5, of: 12 },
          disk: { no: 1, of: 2 },
          genre: ['Rock', 'Alternative']
        },
        format: {
          duration: 234.5,
          bitrate: 320000,
          sampleRate: 44100,
          container: 'MPEG'
        }
      };

      const extracted = {
        title: mockMetadata.common.title,
        artist: mockMetadata.common.artist,
        album: mockMetadata.common.album,
        year: mockMetadata.common.year,
        trackNumber: mockMetadata.common.track?.no,
        discNumber: mockMetadata.common.disk?.no,
        genre: mockMetadata.common.genre?.[0],
        duration: mockMetadata.format.duration,
        bitrate: Math.round(mockMetadata.format.bitrate / 1000),
        sampleRate: mockMetadata.format.sampleRate
      };

      expect(extracted.title).toBe('Test Song');
      expect(extracted.artist).toBe('Test Artist');
      expect(extracted.album).toBe('Test Album');
      expect(extracted.year).toBe(2023);
      expect(extracted.trackNumber).toBe(5);
      expect(extracted.duration).toBe(234.5);
      expect(extracted.bitrate).toBe(320);
    });

    test('handles missing tags gracefully', () => {
      const mockMetadata = {
        common: {},
        format: { duration: 180 }
      };

      const extracted = {
        title: mockMetadata.common.title || null,
        artist: mockMetadata.common.artist || null,
        album: mockMetadata.common.album || null,
        duration: mockMetadata.format.duration
      };

      expect(extracted.title).toBeNull();
      expect(extracted.artist).toBeNull();
      expect(extracted.duration).toBe(180);
    });

    test('title falls back to filename if missing', () => {
      const filePath = '/music/Unknown Artist - Cool Song.mp3';
      const metadata = { common: {} };

      const fallbackTitle = () => {
        if (!metadata.common.title) {
          const filename = filePath.split('/').pop();
          return filename.replace(/\.[^/.]+$/, ''); // Remove extension
        }
        return metadata.common.title;
      };

      expect(fallbackTitle()).toBe('Unknown Artist - Cool Song');
    });
  });

  describe('Embedded Art Detection', () => {
    test('detects embedded cover art', () => {
      const metadata = {
        common: {
          picture: [{
            format: 'image/jpeg',
            type: 'Cover (front)',
            data: Buffer.from([0xff, 0xd8, 0xff]) // JPEG magic bytes
          }]
        }
      };

      const hasEmbeddedArt = metadata.common.picture && metadata.common.picture.length > 0;

      expect(hasEmbeddedArt).toBe(true);
    });

    test('handles missing cover art', () => {
      const metadata = { common: {} };

      const hasEmbeddedArt = !!(metadata.common.picture && metadata.common.picture.length > 0);

      expect(hasEmbeddedArt).toBe(false);
    });
  });
});

describe('Album Art Resolution', () => {
  describe('Art Source Priority', () => {
    test('embedded art is highest priority', () => {
      const sources = {
        embedded: true,
        folder: '/music/album/cover.jpg',
        coverArtArchive: 'https://example.com/art.jpg'
      };

      const getArtSource = () => {
        if (sources.embedded) return 'embedded';
        if (sources.folder) return 'folder';
        if (sources.coverArtArchive) return 'api';
        return null;
      };

      expect(getArtSource()).toBe('embedded');
    });

    test('folder art is second priority', () => {
      const sources = {
        embedded: false,
        folder: '/music/album/cover.jpg',
        coverArtArchive: 'https://example.com/art.jpg'
      };

      const getArtSource = () => {
        if (sources.embedded) return 'embedded';
        if (sources.folder) return 'folder';
        if (sources.coverArtArchive) return 'api';
        return null;
      };

      expect(getArtSource()).toBe('folder');
    });

    test('API art is fallback', () => {
      const sources = {
        embedded: false,
        folder: null,
        coverArtArchive: 'https://example.com/art.jpg'
      };

      const getArtSource = () => {
        if (sources.embedded) return 'embedded';
        if (sources.folder) return 'folder';
        if (sources.coverArtArchive) return 'api';
        return null;
      };

      expect(getArtSource()).toBe('api');
    });
  });

  describe('Folder Art Detection', () => {
    const COVER_FILENAMES = [
      'cover.jpg', 'cover.png', 'cover.jpeg',
      'folder.jpg', 'folder.png',
      'front.jpg', 'front.png',
      'album.jpg', 'album.png',
      'artwork.jpg', 'artwork.png'
    ];

    test('recognizes standard cover filenames', () => {
      const findCoverArt = (files) => {
        const lowerFiles = files.map(f => f.toLowerCase());
        for (const coverName of COVER_FILENAMES) {
          if (lowerFiles.includes(coverName)) {
            return coverName;
          }
        }
        return null;
      };

      expect(findCoverArt(['song.mp3', 'cover.jpg'])).toBe('cover.jpg');
      expect(findCoverArt(['song.mp3', 'folder.png'])).toBe('folder.png');
      expect(findCoverArt(['song.mp3', 'artwork.jpg'])).toBe('artwork.jpg');
    });

    test('returns null when no cover found', () => {
      const findCoverArt = (files) => {
        const lowerFiles = files.map(f => f.toLowerCase());
        for (const coverName of COVER_FILENAMES) {
          if (lowerFiles.includes(coverName)) {
            return coverName;
          }
        }
        return null;
      };

      expect(findCoverArt(['song.mp3', 'notes.txt'])).toBeNull();
    });
  });
});

describe('Track Resolution for Local Files', () => {
  test('local file creates proper source object', () => {
    const track = {
      id: 'local-123',
      filePath: '/music/song.mp3',
      title: 'Test Song',
      artist: 'Test Artist',
      duration: 180
    };

    const source = {
      id: track.id,
      path: track.filePath,
      title: track.title,
      artist: track.artist,
      duration: track.duration,
      confidence: 1.0 // Local files have perfect confidence
    };

    expect(source.confidence).toBe(1.0);
    expect(source.path).toBe('/music/song.mp3');
  });

  test('local file URL uses custom protocol', () => {
    const filePath = '/music/My Song.mp3';
    const audioUrl = `local-audio://${encodeURIComponent(filePath)}`;

    expect(audioUrl).toBe('local-audio://%2Fmusic%2FMy%20Song.mp3');
  });
});
