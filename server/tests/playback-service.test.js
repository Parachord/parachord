const PlaybackService = require('../services/playback-service');

function createMockWSManager() {
  return { broadcast: jest.fn(), send: jest.fn(), on: jest.fn(), off: jest.fn() };
}

function createMockQueueService() {
  let idx = 0;
  const tracks = [];
  return {
    getState: () => ({ tracks, currentIndex: idx, currentTrack: tracks[idx] || null }),
    next: jest.fn(() => { idx++; return tracks[idx] || null; }),
    previous: jest.fn(() => { if (idx > 0) idx--; return tracks[idx] || null; }),
    jumpTo: jest.fn((i) => { idx = i; return tracks[idx]; }),
    getUpcoming: jest.fn(() => []),
    addTracks: (t) => { tracks.push(...(Array.isArray(t) ? t : [t])); if (idx < 0) idx = 0; },
    _setTracks: (t) => { tracks.length = 0; tracks.push(...t); idx = 0; }
  };
}

function createMockResolverService() {
  return {
    resolve: jest.fn().mockResolvedValue({ streamUrl: 'https://example.com/stream.mp3' })
  };
}

function createMockAuthService() {
  return {
    getToken: jest.fn().mockResolvedValue({ token: 'test-token', expiresAt: Date.now() + 3600000 })
  };
}

describe('PlaybackService', () => {
  let playback;
  let wsManager;
  let queueService;
  let resolverService;
  let authService;

  beforeEach(() => {
    wsManager = createMockWSManager();
    queueService = createMockQueueService();
    resolverService = createMockResolverService();
    authService = createMockAuthService();
    playback = new PlaybackService({
      queueService, resolverService, authService, wsManager
    });
  });

  test('initial state is idle', () => {
    expect(playback.getState().state).toBe('idle');
    expect(playback.getState().currentTrack).toBeNull();
  });

  test('play resolves and broadcasts', async () => {
    const track = { title: 'Creep', artist: 'Radiohead', resolverId: 'spotify' };
    await playback.play(track);

    expect(resolverService.resolve).toHaveBeenCalledWith(track);
    expect(playback.getState().state).toBe('playing');
    expect(wsManager.broadcast).toHaveBeenCalledWith('playback:play', expect.objectContaining({
      track,
      streamUrl: 'https://example.com/stream.mp3'
    }));
  });

  test('play attaches spotify credentials', async () => {
    const track = { title: 'Song', artist: 'Artist', resolverId: 'spotify' };
    await playback.play(track);

    const playCall = wsManager.broadcast.mock.calls.find(c => c[0] === 'playback:play');
    expect(playCall[1].credentials).toEqual({ spotifyToken: 'test-token' });
  });

  test('play throws and stays idle when resolve fails', async () => {
    resolverService.resolve.mockResolvedValue(null);
    const track = { title: 'Missing', artist: 'Unknown' };

    await expect(playback.play(track)).rejects.toThrow('Could not resolve');
    expect(playback.getState().state).toBe('idle');
  });

  test('pause changes state', async () => {
    await playback.play({ title: 'A', artist: 'B' });
    playback.pause();
    expect(playback.getState().state).toBe('paused');
    expect(wsManager.broadcast).toHaveBeenCalledWith('playback:pause', {});
  });

  test('resume after pause', async () => {
    await playback.play({ title: 'A', artist: 'B' });
    playback.pause();
    playback.resume();
    expect(playback.getState().state).toBe('playing');
    expect(wsManager.broadcast).toHaveBeenCalledWith('playback:resume', {});
  });

  test('stop resets state', async () => {
    await playback.play({ title: 'A', artist: 'B' });
    playback.stop();
    expect(playback.getState().state).toBe('idle');
    expect(playback.getState().currentTrack).toBeNull();
  });

  test('next plays next queue track', async () => {
    queueService._setTracks([
      { title: 'A', artist: 'X' },
      { title: 'B', artist: 'Y' }
    ]);
    queueService.next.mockReturnValue({ title: 'B', artist: 'Y' });

    await playback.next();
    expect(resolverService.resolve).toHaveBeenCalledWith(expect.objectContaining({ title: 'B' }));
  });

  test('next stops when queue is exhausted', async () => {
    queueService.next.mockReturnValue(null);
    await playback.next();
    expect(playback.getState().state).toBe('idle');
  });

  test('seek broadcasts position', async () => {
    await playback.play({ title: 'A', artist: 'B' });
    await playback.seek(60);
    expect(wsManager.broadcast).toHaveBeenCalledWith('playback:seek', { position: 60 });
  });

  test('playFromQueue plays from queue', async () => {
    queueService._setTracks([{ title: 'First' }, { title: 'Second' }]);
    queueService.jumpTo.mockReturnValue({ title: 'Second' });

    await playback.playFromQueue(1);
    expect(queueService.jumpTo).toHaveBeenCalledWith(1);
  });
});
