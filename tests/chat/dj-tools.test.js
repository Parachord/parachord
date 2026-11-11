/**
 * DJ Tools Tests
 *
 * Tests for executeDjTool - the function that executes playback actions
 * on behalf of AI chat providers (play, search, queue, shuffle, etc.)
 *
 * Two test styles live in this file:
 *   1. The original style (further down) reimplements `executeDjTool` inline
 *      to test the playback logic without pulling in app.js's React deps.
 *   2. The `seek` / `get_position` / `registry` blocks at the bottom import
 *      directly from `tools/dj-tools.js` to verify the tool definitions and
 *      their thin execute wrappers exactly as the MCP server sees them.
 */

const { getTool } = require('../../tools/dj-tools');
const { runPlaybackControl } = require('../../tools/playback-control');
const { pickTrackMatch } = require('../../sync-providers/track-match');
const { runQueueAdd } = require('../../tools/queue-add');

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
        const bestMatch = pickTrackMatch(results, args.artist, args.title);
        if (!bestMatch) {
          return { success: false, error: `Could not find "${args.title}" by ${args.artist}` };
        }
        await context.playTrack(bestMatch);
        return { success: true, track: { artist: bestMatch.artist, title: bestMatch.title, album: bestMatch.album } };
      }
      case 'control':
        return runPlaybackControl(args.action, context);
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
      case 'queue_add':
        return runQueueAdd(args, context);
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

    test('plays another version when it is the only match', async () => {
      context.search.mockResolvedValue([
        { artist: 'Radiohead', title: 'Creep (Live)', album: 'Live Album' }
      ]);

      const result = await executeDjTool('play', { artist: 'Radiohead', title: 'Creep' }, context);

      expect(result.success).toBe(true);
      expect(result.track.title).toBe('Creep (Live)');
      expect(context.playTrack).toHaveBeenCalled();
    });

    test('refuses a result that is a different song (#1241)', async () => {
      context.search.mockResolvedValue([
        { artist: 'The Avett Brothers', title: 'Untitled #4', album: 'Other' }
      ]);

      const result = await executeDjTool('play', { artist: 'Biohio', title: 'Happy Me' }, context);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Could not find');
      expect(context.playTrack).not.toHaveBeenCalled();
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

    describe('a track that is not found (#1259)', () => {
      const hits = {
        'Swapmeet I Know!': [{ artist: 'Swapmeet', title: 'I Know!', album: 'Mount Zero' }],
        'Queen Bohemian Rhapsody': [{ artist: 'Queen', title: 'Bohemian Rhapsody' }]
      };
      const wrong = [{ artist: 'The Avett Brothers', title: 'Untitled #4' }];

      beforeEach(() => {
        context.getCurrentTrack.mockReturnValue(null);
        context.search.mockImplementation(async (query) => hits[query] || wrong);
      });

      test('starts with the first track found, and queues the rest', async () => {
        const result = await executeDjTool('queue_add', {
          tracks: [
            { artist: 'Biohio', title: 'Happy Me' },
            { artist: 'Swapmeet', title: 'I Know!' },
            { artist: 'Queen', title: 'Bohemian Rhapsody' }
          ]
        }, context);

        expect(context.playTrack).toHaveBeenCalledTimes(1);
        expect(context.playTrack).toHaveBeenCalledWith(hits['Swapmeet I Know!'][0]);
        expect(context.addToQueue).toHaveBeenCalledWith(
          [expect.objectContaining({ artist: 'Queen', title: 'Bohemian Rhapsody' })],
          'last'
        );
        expect(result).toEqual({
          success: true,
          added: 2,
          nowPlaying: true,
          notFound: [{ artist: 'Biohio', title: 'Happy Me' }]
        });
      });

      test('lists every track it skipped on the way to the first one found', async () => {
        const result = await executeDjTool('queue_add', {
          tracks: [
            { artist: 'Biohio', title: 'Happy Me' },
            { artist: 'Biohio', title: 'Love' },
            { artist: 'Swapmeet', title: 'I Know!' }
          ]
        }, context);

        expect(result.nowPlaying).toBe(true);
        expect(result.added).toBe(1);
        expect(result.notFound).toEqual([
          { artist: 'Biohio', title: 'Happy Me' },
          { artist: 'Biohio', title: 'Love' }
        ]);
      });

      test('stops searching once one is found', async () => {
        await executeDjTool('queue_add', {
          tracks: [
            { artist: 'Swapmeet', title: 'I Know!' },
            { artist: 'Biohio', title: 'Happy Me' }
          ]
        }, context);

        expect(context.search).toHaveBeenCalledTimes(1);
      });

      test('when none are found it says so and leaves the queue alone', async () => {
        const result = await executeDjTool('queue_add', {
          tracks: [
            { artist: 'Biohio', title: 'Happy Me' },
            { artist: 'Biohio', title: 'Love' }
          ]
        }, context);

        expect(result).toEqual({
          success: false,
          added: 0,
          nowPlaying: false,
          notFound: [
            { artist: 'Biohio', title: 'Happy Me' },
            { artist: 'Biohio', title: 'Love' }
          ],
          error: 'Could not find any of the requested tracks'
        });
        expect(context.playTrack).not.toHaveBeenCalled();
        expect(context.addToQueue).not.toHaveBeenCalled();
        expect(context.clearQueue).not.toHaveBeenCalled();
      });

      test('with something already playing it searches nothing', async () => {
        context.getCurrentTrack.mockReturnValue({ artist: 'Current', title: 'Playing' });

        const result = await executeDjTool('queue_add', {
          tracks: [{ artist: 'Biohio', title: 'Happy Me' }]
        }, context);

        expect(context.search).not.toHaveBeenCalled();
        expect(result).toEqual({ success: true, added: 1, nowPlaying: false });
      });

      test('the app runs this code, not a copy', () => {
        const app = require('fs').readFileSync(
          require('path').join(__dirname, '../../src/renderer/app.js'), 'utf8');
        expect(app).toMatch(/case 'queue_add':\s*\n?\s*return runQueueAdd\(args, context\);/);
      });

      test('the chat summary names what was skipped', () => {
        const app = require('fs').readFileSync(
          require('path').join(__dirname, '../../src/renderer/app.js'), 'utf8');
        const start = app.indexOf('summarizeToolResults(toolResults) {');
        expect(app.slice(start, app.indexOf("case 'queue_clear'", start))).toContain('Could not find ${skipped}');
      });
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

// ─── Real-import tests for the new seek / get_position tools ──────────────────
// These verify the tool definitions and `execute` wrappers exported from
// `tools/dj-tools.js`. Unlike the executeDjTool tests above, they do not
// reimplement anything — they call into the actual module.

describe('seek tool', () => {
  test('calls context.handleSeek with offset_ms and returns its result', async () => {
    const handleSeek = jest.fn().mockResolvedValue({ success: true, supported: true, position_ms: 12345 });
    const tool = getTool('seek');
    expect(tool).toBeDefined();
    const result = await tool.execute({ offset_ms: 12345 }, { handleSeek });
    expect(handleSeek).toHaveBeenCalledWith(12345);
    expect(result.success).toBe(true);
    expect(result.position_ms).toBe(12345);
  });

  test('coerces non-number offsets to 0', async () => {
    const handleSeek = jest.fn().mockResolvedValue({ success: true, supported: true });
    const tool = getTool('seek');
    await tool.execute({ offset_ms: 'not a number' }, { handleSeek });
    expect(handleSeek).toHaveBeenCalledWith(0);
  });

  test('returns supported:false when context lacks handleSeek (older app build)', async () => {
    const tool = getTool('seek');
    const result = await tool.execute({ offset_ms: 1000 }, {});
    expect(result.success).toBe(false);
    expect(result.supported).toBe(false);
  });

  test('passes through supported:false from an engine that cannot seek', async () => {
    const handleSeek = jest.fn().mockResolvedValue({ success: false, supported: false, error: 'no seekable engine for active resolver' });
    const tool = getTool('seek');
    const result = await tool.execute({ offset_ms: 1000 }, { handleSeek });
    expect(result.supported).toBe(false);
    expect(result.error).toBe('no seekable engine for active resolver');
  });
});

describe('get_position tool', () => {
  test('returns context.getCurrentPosition() with numeric normalization', async () => {
    const getCurrentPosition = jest.fn().mockReturnValue({ position_ms: 30000, duration_ms: 240000, supported: true });
    const tool = getTool('get_position');
    expect(tool).toBeDefined();
    const result = await tool.execute({}, { getCurrentPosition });
    expect(getCurrentPosition).toHaveBeenCalled();
    expect(result.position_ms).toBe(30000);
    expect(result.duration_ms).toBe(240000);
    expect(result.supported).toBe(true);
  });

  test('handles missing supported flag as true', async () => {
    const getCurrentPosition = jest.fn().mockReturnValue({ position_ms: 0, duration_ms: 1000 });
    const tool = getTool('get_position');
    const result = await tool.execute({}, { getCurrentPosition });
    expect(result.supported).toBe(true);
  });

  test('returns supported:false when context lacks getCurrentPosition', async () => {
    const tool = getTool('get_position');
    const result = await tool.execute({}, {});
    expect(result.position_ms).toBe(0);
    expect(result.duration_ms).toBe(0);
    expect(result.supported).toBe(false);
  });

  test('coerces non-number values to 0', async () => {
    const getCurrentPosition = jest.fn().mockReturnValue({ position_ms: 'oops', duration_ms: null, supported: true });
    const tool = getTool('get_position');
    const result = await tool.execute({}, { getCurrentPosition });
    expect(result.position_ms).toBe(0);
    expect(result.duration_ms).toBe(0);
  });

  test('position 0 is a valid supported position (track at start)', async () => {
    const getCurrentPosition = jest.fn().mockReturnValue({ position_ms: 0, duration_ms: 240000, supported: true });
    const tool = getTool('get_position');
    const result = await tool.execute({}, { getCurrentPosition });
    expect(result.position_ms).toBe(0);
    expect(result.duration_ms).toBe(240000);
    expect(result.supported).toBe(true);
  });
});

describe('registry exposes the new tools', () => {
  test('seek and get_position are both registered by name', () => {
    expect(getTool('seek')).toBeDefined();
    expect(getTool('get_position')).toBeDefined();
  });

  test('both have JSON-schema parameters consumable by MCP/Claude/OpenAI', () => {
    const seek = getTool('seek');
    expect(seek.parameters.required).toEqual(['offset_ms']);
    expect(seek.parameters.properties.offset_ms.type).toBe('number');
    const pos = getTool('get_position');
    expect(pos.parameters.type).toBe('object');
  });
});

// These run the real wrappers in tools/dj-tools.js, not the inline copy above.
describe('tools/dj-tools.js never plays a different song (#1241)', () => {
  const WRONG = { artist: 'The Avett Brothers', title: 'Untitled #4', album: 'Other' };
  let context;

  beforeEach(() => {
    context = {
      search: jest.fn().mockResolvedValue([WRONG]),
      playTrack: jest.fn().mockResolvedValue(undefined),
      clearQueue: jest.fn(),
      addToQueue: jest.fn().mockResolvedValue(undefined),
      getQueue: jest.fn().mockReturnValue([]),
      getCurrentTrack: jest.fn().mockReturnValue(null),
      getIsPlaying: jest.fn().mockReturnValue(false),
    };
  });

  test('play reports not found and keeps the queue', async () => {
    const result = await getTool('play').execute({ artist: 'Biohio', title: 'Happy Me' }, context);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Could not find');
    expect(context.playTrack).not.toHaveBeenCalled();
    expect(context.clearQueue).not.toHaveBeenCalled();
  });

  test('play still plays the requested track', async () => {
    const right = { artist: 'Biohio', title: 'Happy Me', album: 'Album' };
    context.search.mockResolvedValue([WRONG, right]);

    const result = await getTool('play').execute({ artist: 'Biohio', title: 'Happy Me' }, context);

    expect(result.success).toBe(true);
    expect(context.playTrack).toHaveBeenCalledWith(right);
  });

  test('queue_add does not start a different song', async () => {
    const result = await getTool('queue_add').execute({
      tracks: [{ artist: 'Biohio', title: 'Happy Me' }],
      playFirst: true,
    }, context);

    expect(context.playTrack).not.toHaveBeenCalled();
    expect(result.nowPlaying).toBe(false);
  });
});
