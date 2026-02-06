/**
 * DJ Tools Tests
 *
 * Tests for executeDjTool - the function that executes playback actions
 * on behalf of AI chat providers (play, search, queue, shuffle, etc.)
 */

// Extract executeDjTool and related code from app.js
// Since app.js is a monolithic React component, we recreate the pure functions here
// matching the exact implementation from app.js lines 3527-3696

const executeDjTool = async (name, args, context) => {
  try {
    switch (name) {
      case 'play': {
        const query = `${args.artist} ${args.title}`;
        const results = await context.search(query, {
          earlyReturn: true,
          targetArtist: args.artist,
          targetTitle: args.title
        });
        if (!results || results.length === 0) {
          return { success: false, error: `Could not find "${args.title}" by ${args.artist}` };
        }
        const bestMatch = results.find(r =>
          r.artist?.toLowerCase() === args.artist.toLowerCase() &&
          r.title?.toLowerCase() === args.title.toLowerCase()
        ) || results[0];
        await context.playTrack(bestMatch);
        return { success: true, track: { artist: bestMatch.artist, title: bestMatch.title, album: bestMatch.album } };
      }
      case 'control': {
        switch (args.action) {
          case 'pause': context.handlePause(); return { success: true, action: 'paused' };
          case 'resume':
          case 'start': {
            const isPlaying = context.getIsPlaying();
            const queue = context.getQueue();
            if (!isPlaying && queue.length > 0) {
              const firstTrack = queue[0];
              await context.playTrack(firstTrack);
              return { success: true, action: 'started', track: { artist: firstTrack.artist, title: firstTrack.title } };
            }
            context.handleResume();
            return { success: true, action: 'resumed' };
          }
          case 'skip': context.handleNext(); return { success: true, action: 'skipped' };
          case 'previous': context.handlePrevious(); return { success: true, action: 'previous' };
          default: return { success: false, error: `Unknown action: ${args.action}` };
        }
      }
      case 'search': {
        const results = await context.search(args.query);
        const limit = args.limit || 10;
        return {
          success: true,
          results: (results || []).slice(0, limit).map(r => ({
            artist: r.artist,
            title: r.title,
            album: r.album,
            albumArt: r.albumArt || null
          })),
          total: results?.length || 0
        };
      }
      case 'queue_add': {
        const nothingPlaying = !context.getCurrentTrack();
        let startedPlaying = false;
        let tracksToQueue = args.tracks;

        if (nothingPlaying && args.tracks.length > 0) {
          const firstTrack = args.tracks[0];
          const results = await context.search(`${firstTrack.artist} ${firstTrack.title}`, {
            earlyReturn: true,
            targetArtist: firstTrack.artist,
            targetTitle: firstTrack.title
          });
          if (results && results.length > 0) {
            const match = results.find(r =>
              r.artist?.toLowerCase() === firstTrack.artist.toLowerCase() &&
              r.title?.toLowerCase() === firstTrack.title.toLowerCase()
            ) || results[0];
            await context.playTrack(match);
            startedPlaying = true;
          }
          tracksToQueue = args.tracks.slice(1);
        }

        if (tracksToQueue.length > 0) {
          const metadataTracks = tracksToQueue.map(t => ({
            artist: t.artist,
            title: t.title,
            album: t.album || null
          }));
          await context.addToQueue(metadataTracks, args.position || 'last');
        }

        const totalAdded = tracksToQueue.length + (startedPlaying ? 1 : 0);
        return {
          success: totalAdded > 0,
          added: totalAdded,
          nowPlaying: startedPlaying
        };
      }
      case 'queue_remove': {
        const queue = context.getQueue();
        const toRemove = [];
        const filterArtist = args.artist?.toLowerCase();
        const filterTitle = args.title?.toLowerCase();

        if (!filterArtist && !filterTitle) {
          return { success: false, error: 'Must specify artist or title to remove' };
        }

        for (const track of queue) {
          const matchesArtist = filterArtist && track.artist?.toLowerCase().includes(filterArtist);
          const matchesTitle = filterTitle && track.title?.toLowerCase().includes(filterTitle);

          if (filterArtist && filterTitle) {
            if (matchesArtist && matchesTitle) toRemove.push(track);
          } else if (matchesArtist || matchesTitle) {
            toRemove.push(track);
          }
        }

        for (const track of toRemove) {
          context.removeFromQueue(track.id);
        }

        return {
          success: true,
          removed: toRemove.length,
          tracks: toRemove.map(t => ({ artist: t.artist, title: t.title }))
        };
      }
      case 'queue_clear': {
        context.clearQueue();
        return { success: true };
      }
      case 'create_playlist': {
        if (!args.tracks || args.tracks.length === 0) {
          return { success: false, error: 'No tracks specified for playlist' };
        }
        const metadataTracks = args.tracks.map(t => ({
          artist: t.artist,
          title: t.title,
          album: t.album || null
        }));
        const playlist = await context.createPlaylist(args.name, metadataTracks);
        return { success: true, playlist: { id: playlist.id, name: playlist.title || args.name, trackCount: metadataTracks.length } };
      }
      case 'shuffle': {
        context.setShuffle(args.enabled);
        return { success: true, shuffle: args.enabled };
      }
      case 'collection_radio': {
        const result = context.startCollectionRadio();
        if (!result.success) {
          return { success: false, error: result.error };
        }
        return { success: true, trackCount: result.trackCount };
      }
      default:
        return { success: false, error: `Unknown tool: ${name}` };
    }
  } catch (error) {
    return { success: false, error: error.message || 'Tool execution failed' };
  }
};

// Helper to create a mock tool context
function createMockToolContext(overrides = {}) {
  return {
    search: jest.fn().mockResolvedValue([]),
    playTrack: jest.fn().mockResolvedValue(),
    addToQueue: jest.fn().mockResolvedValue(),
    removeFromQueue: jest.fn(),
    clearQueue: jest.fn(),
    handlePause: jest.fn(),
    handleResume: jest.fn(),
    handleNext: jest.fn(),
    handlePrevious: jest.fn(),
    setShuffle: jest.fn(),
    startCollectionRadio: jest.fn().mockReturnValue({ success: true, trackCount: 50 }),
    getCurrentTrack: jest.fn().mockReturnValue(null),
    getQueue: jest.fn().mockReturnValue([]),
    getIsPlaying: jest.fn().mockReturnValue(false),
    createPlaylist: jest.fn().mockResolvedValue({ id: 'test-playlist-1', title: 'Test Playlist' }),
    ...overrides
  };
}

const searchResults = [
  { artist: 'Radiohead', title: 'Creep', album: 'Pablo Honey', albumArt: 'https://example.com/art.jpg' },
  { artist: 'Radiohead', title: 'Karma Police', album: 'OK Computer' },
  { artist: 'Radio Dept.', title: 'Closing Scene', album: 'Lesser Matters' }
];

describe('DJ Tools - executeDjTool', () => {
  let context;

  beforeEach(() => {
    context = createMockToolContext();
  });

  describe('play', () => {
    test('searches and plays exact match', async () => {
      context.search.mockResolvedValue([
        { artist: 'Radiohead', title: 'Creep', album: 'Pablo Honey' },
        { artist: 'Radio Dept.', title: 'Creep', album: 'Other' }
      ]);

      const result = await executeDjTool('play', { artist: 'Radiohead', title: 'Creep' }, context);

      expect(result.success).toBe(true);
      expect(result.track.artist).toBe('Radiohead');
      expect(result.track.title).toBe('Creep');
      expect(context.search).toHaveBeenCalledWith('Radiohead Creep', {
        earlyReturn: true,
        targetArtist: 'Radiohead',
        targetTitle: 'Creep'
      });
      expect(context.playTrack).toHaveBeenCalledWith(expect.objectContaining({ artist: 'Radiohead', title: 'Creep' }));
    });

    test('falls back to first result when no exact match', async () => {
      context.search.mockResolvedValue([
        { artist: 'Radiohead', title: 'Creep (Live)', album: 'Live Album' }
      ]);

      const result = await executeDjTool('play', { artist: 'Radiohead', title: 'Creep' }, context);

      expect(result.success).toBe(true);
      expect(result.track.title).toBe('Creep (Live)');
      expect(context.playTrack).toHaveBeenCalled();
    });

    test('returns error when no results found', async () => {
      context.search.mockResolvedValue([]);

      const result = await executeDjTool('play', { artist: 'Nonexistent', title: 'Nothing' }, context);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Could not find');
      expect(context.playTrack).not.toHaveBeenCalled();
    });

    test('returns error when search returns null', async () => {
      context.search.mockResolvedValue(null);

      const result = await executeDjTool('play', { artist: 'Test', title: 'Test' }, context);

      expect(result.success).toBe(false);
    });

    test('case-insensitive exact matching', async () => {
      context.search.mockResolvedValue([
        { artist: 'radiohead', title: 'creep', album: 'Pablo Honey' }
      ]);

      const result = await executeDjTool('play', { artist: 'Radiohead', title: 'Creep' }, context);

      expect(result.success).toBe(true);
      expect(context.playTrack).toHaveBeenCalled();
    });
  });

  describe('control', () => {
    test('pause calls handlePause', async () => {
      const result = await executeDjTool('control', { action: 'pause' }, context);

      expect(result.success).toBe(true);
      expect(result.action).toBe('paused');
      expect(context.handlePause).toHaveBeenCalled();
    });

    test('resume calls handleResume when playing', async () => {
      context.getIsPlaying.mockReturnValue(true);

      const result = await executeDjTool('control', { action: 'resume' }, context);

      expect(result.success).toBe(true);
      expect(result.action).toBe('resumed');
      expect(context.handleResume).toHaveBeenCalled();
    });

    test('start plays first queue item when not playing', async () => {
      context.getIsPlaying.mockReturnValue(false);
      context.getQueue.mockReturnValue([
        { artist: 'Radiohead', title: 'Creep' },
        { artist: 'Radiohead', title: 'Karma Police' }
      ]);

      const result = await executeDjTool('control', { action: 'start' }, context);

      expect(result.success).toBe(true);
      expect(result.action).toBe('started');
      expect(result.track.title).toBe('Creep');
      expect(context.playTrack).toHaveBeenCalled();
    });

    test('start resumes when already playing', async () => {
      context.getIsPlaying.mockReturnValue(true);

      const result = await executeDjTool('control', { action: 'start' }, context);

      expect(result.success).toBe(true);
      expect(result.action).toBe('resumed');
      expect(context.handleResume).toHaveBeenCalled();
    });

    test('start resumes when queue empty', async () => {
      context.getIsPlaying.mockReturnValue(false);
      context.getQueue.mockReturnValue([]);

      const result = await executeDjTool('control', { action: 'start' }, context);

      expect(result.action).toBe('resumed');
    });

    test('skip calls handleNext', async () => {
      const result = await executeDjTool('control', { action: 'skip' }, context);

      expect(result.action).toBe('skipped');
      expect(context.handleNext).toHaveBeenCalled();
    });

    test('previous calls handlePrevious', async () => {
      const result = await executeDjTool('control', { action: 'previous' }, context);

      expect(result.action).toBe('previous');
      expect(context.handlePrevious).toHaveBeenCalled();
    });

    test('unknown action returns error', async () => {
      const result = await executeDjTool('control', { action: 'invalid' }, context);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown action');
    });
  });

  describe('search', () => {
    test('returns formatted results', async () => {
      context.search.mockResolvedValue(searchResults);

      const result = await executeDjTool('search', { query: 'radiohead' }, context);

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(3);
      expect(result.results[0]).toEqual({
        artist: 'Radiohead',
        title: 'Creep',
        album: 'Pablo Honey',
        albumArt: 'https://example.com/art.jpg'
      });
      expect(result.total).toBe(3);
    });

    test('respects limit parameter', async () => {
      context.search.mockResolvedValue(searchResults);

      const result = await executeDjTool('search', { query: 'radiohead', limit: 1 }, context);

      expect(result.results).toHaveLength(1);
      expect(result.total).toBe(3);
    });

    test('defaults to limit of 10', async () => {
      const manyResults = Array.from({ length: 15 }, (_, i) => ({
        artist: `Artist ${i}`, title: `Track ${i}`, album: `Album ${i}`
      }));
      context.search.mockResolvedValue(manyResults);

      const result = await executeDjTool('search', { query: 'test' }, context);

      expect(result.results).toHaveLength(10);
    });

    test('handles null search results', async () => {
      context.search.mockResolvedValue(null);

      const result = await executeDjTool('search', { query: 'nothing' }, context);

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    test('sets null albumArt when missing', async () => {
      context.search.mockResolvedValue([{ artist: 'Test', title: 'Song', album: 'Album' }]);

      const result = await executeDjTool('search', { query: 'test' }, context);

      expect(result.results[0].albumArt).toBeNull();
    });
  });

  describe('queue_add', () => {
    test('adds tracks to queue when something is playing', async () => {
      context.getCurrentTrack.mockReturnValue({ artist: 'Current', title: 'Playing' });

      const result = await executeDjTool('queue_add', {
        tracks: [
          { artist: 'Radiohead', title: 'Creep' },
          { artist: 'Radiohead', title: 'Karma Police' }
        ]
      }, context);

      expect(result.success).toBe(true);
      expect(result.added).toBe(2);
      expect(result.nowPlaying).toBe(false);
      expect(context.addToQueue).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ artist: 'Radiohead', title: 'Creep' })
        ]),
        'last'
      );
    });

    test('plays first track when nothing playing', async () => {
      context.getCurrentTrack.mockReturnValue(null);
      context.search.mockResolvedValue([
        { artist: 'Radiohead', title: 'Creep', album: 'Pablo Honey' }
      ]);

      const result = await executeDjTool('queue_add', {
        tracks: [
          { artist: 'Radiohead', title: 'Creep' },
          { artist: 'Radiohead', title: 'Karma Police' }
        ]
      }, context);

      expect(result.success).toBe(true);
      expect(result.nowPlaying).toBe(true);
      expect(context.playTrack).toHaveBeenCalled();
      // Second track queued
      expect(context.addToQueue).toHaveBeenCalledWith(
        [expect.objectContaining({ artist: 'Radiohead', title: 'Karma Police' })],
        'last'
      );
    });

    test('respects position parameter', async () => {
      context.getCurrentTrack.mockReturnValue({ artist: 'Current', title: 'Playing' });

      await executeDjTool('queue_add', {
        tracks: [{ artist: 'Test', title: 'Track' }],
        position: 'next'
      }, context);

      expect(context.addToQueue).toHaveBeenCalledWith(expect.anything(), 'next');
    });

    test('handles single track when nothing playing and search fails', async () => {
      context.getCurrentTrack.mockReturnValue(null);
      context.search.mockResolvedValue([]);

      const result = await executeDjTool('queue_add', {
        tracks: [{ artist: 'Unknown', title: 'Missing' }]
      }, context);

      expect(result.success).toBe(false);
      expect(result.added).toBe(0);
    });
  });

  describe('queue_remove', () => {
    const queue = [
      { id: '1', artist: 'Radiohead', title: 'Creep' },
      { id: '2', artist: 'Radiohead', title: 'Karma Police' },
      { id: '3', artist: 'Nirvana', title: 'Creep' }
    ];

    test('removes by artist', async () => {
      context.getQueue.mockReturnValue(queue);

      const result = await executeDjTool('queue_remove', { artist: 'Radiohead' }, context);

      expect(result.success).toBe(true);
      expect(result.removed).toBe(2);
      expect(context.removeFromQueue).toHaveBeenCalledTimes(2);
    });

    test('removes by title', async () => {
      context.getQueue.mockReturnValue(queue);

      const result = await executeDjTool('queue_remove', { title: 'Creep' }, context);

      expect(result.removed).toBe(2);
    });

    test('removes by both artist AND title', async () => {
      context.getQueue.mockReturnValue(queue);

      const result = await executeDjTool('queue_remove', { artist: 'Radiohead', title: 'Creep' }, context);

      expect(result.removed).toBe(1);
      expect(context.removeFromQueue).toHaveBeenCalledWith('1');
    });

    test('case-insensitive matching', async () => {
      context.getQueue.mockReturnValue(queue);

      const result = await executeDjTool('queue_remove', { artist: 'radiohead' }, context);

      expect(result.removed).toBe(2);
    });

    test('returns error when no filter specified', async () => {
      const result = await executeDjTool('queue_remove', {}, context);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Must specify');
    });

    test('returns 0 removed when no matches', async () => {
      context.getQueue.mockReturnValue(queue);

      const result = await executeDjTool('queue_remove', { artist: 'Beatles' }, context);

      expect(result.removed).toBe(0);
    });
  });

  describe('queue_clear', () => {
    test('clears the queue', async () => {
      const result = await executeDjTool('queue_clear', {}, context);

      expect(result.success).toBe(true);
      expect(context.clearQueue).toHaveBeenCalled();
    });
  });

  describe('create_playlist', () => {
    test('creates playlist with tracks', async () => {
      const result = await executeDjTool('create_playlist', {
        name: 'My Playlist',
        tracks: [
          { artist: 'Radiohead', title: 'Creep', album: 'Pablo Honey' },
          { artist: 'Nirvana', title: 'Smells Like Teen Spirit' }
        ]
      }, context);

      expect(result.success).toBe(true);
      expect(result.playlist.id).toBe('test-playlist-1');
      expect(result.playlist.trackCount).toBe(2);
      expect(context.createPlaylist).toHaveBeenCalledWith('My Playlist', [
        { artist: 'Radiohead', title: 'Creep', album: 'Pablo Honey' },
        { artist: 'Nirvana', title: 'Smells Like Teen Spirit', album: null }
      ]);
    });

    test('returns error for empty tracks', async () => {
      const result = await executeDjTool('create_playlist', {
        name: 'Empty',
        tracks: []
      }, context);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No tracks');
    });

    test('returns error for missing tracks', async () => {
      const result = await executeDjTool('create_playlist', { name: 'Test' }, context);

      expect(result.success).toBe(false);
    });
  });

  describe('shuffle', () => {
    test('enables shuffle', async () => {
      const result = await executeDjTool('shuffle', { enabled: true }, context);

      expect(result.success).toBe(true);
      expect(result.shuffle).toBe(true);
      expect(context.setShuffle).toHaveBeenCalledWith(true);
    });

    test('disables shuffle', async () => {
      const result = await executeDjTool('shuffle', { enabled: false }, context);

      expect(result.shuffle).toBe(false);
      expect(context.setShuffle).toHaveBeenCalledWith(false);
    });
  });

  describe('collection_radio', () => {
    test('starts collection radio', async () => {
      const result = await executeDjTool('collection_radio', {}, context);

      expect(result.success).toBe(true);
      expect(result.trackCount).toBe(50);
      expect(context.startCollectionRadio).toHaveBeenCalled();
    });

    test('returns error when collection radio fails', async () => {
      context.startCollectionRadio.mockReturnValue({ success: false, error: 'No tracks in collection' });

      const result = await executeDjTool('collection_radio', {}, context);

      expect(result.success).toBe(false);
      expect(result.error).toContain('No tracks');
    });
  });

  describe('error handling', () => {
    test('unknown tool returns error', async () => {
      const result = await executeDjTool('nonexistent', {}, context);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown tool');
    });

    test('catches thrown errors', async () => {
      context.search.mockRejectedValue(new Error('Network failure'));

      const result = await executeDjTool('play', { artist: 'Test', title: 'Test' }, context);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network failure');
    });

    test('handles playTrack throwing', async () => {
      context.search.mockResolvedValue([{ artist: 'Test', title: 'Song' }]);
      context.playTrack.mockRejectedValue(new Error('Playback failed'));

      const result = await executeDjTool('play', { artist: 'Test', title: 'Song' }, context);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Playback failed');
    });
  });
});
