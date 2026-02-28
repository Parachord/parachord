const fs = require('fs');
const path = require('path');
const os = require('os');
const CollectionService = require('../services/collection-service');

function createMockWSManager() {
  return { broadcast: jest.fn(), send: jest.fn(), on: jest.fn(), off: jest.fn() };
}

describe('CollectionService', () => {
  let service;
  let wsManager;
  let tmpDir;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `parachord-collection-test-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    wsManager = createMockWSManager();
    service = new CollectionService(tmpDir, wsManager);
  });

  afterEach(() => {
    try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
  });

  test('starts empty', () => {
    expect(service.total).toBe(0);
    expect(service.getTracks().tracks).toEqual([]);
  });

  test('addTracks adds tracks', () => {
    service.addTracks([
      { title: 'Song 1', artist: 'Artist A' },
      { title: 'Song 2', artist: 'Artist B' }
    ]);
    expect(service.total).toBe(2);
  });

  test('addTracks deduplicates by title+artist', () => {
    service.addTracks({ title: 'Song', artist: 'Artist' });
    service.addTracks({ title: 'Song', artist: 'Artist' });
    expect(service.total).toBe(1);
  });

  test('addTracks broadcasts update', () => {
    service.addTracks({ title: 'Test', artist: 'Test' });
    expect(wsManager.broadcast).toHaveBeenCalledWith(
      'collection:updated',
      { total: 1 }
    );
  });

  test('removeTrack removes a track', () => {
    service.addTracks({ title: 'Remove Me', artist: 'Artist' });
    service.removeTrack('Remove Me', 'Artist');
    expect(service.total).toBe(0);
  });

  test('removeTrack throws for missing track', () => {
    expect(() => service.removeTrack('Missing', 'Artist')).toThrow('not found');
  });

  test('getTracks with pagination', () => {
    const tracks = Array.from({ length: 10 }, (_, i) => ({
      title: `Song ${i}`, artist: `Artist ${i}`
    }));
    service.addTracks(tracks);

    const page1 = service.getTracks({ page: 1, limit: 3 });
    expect(page1.tracks).toHaveLength(3);
    expect(page1.total).toBe(10);
    expect(page1.pages).toBe(4);

    const page2 = service.getTracks({ page: 2, limit: 3 });
    expect(page2.tracks).toHaveLength(3);
    expect(page2.tracks[0].title).toBe('Song 3');
  });

  test('getTracks with search filter', () => {
    service.addTracks([
      { title: 'Creep', artist: 'Radiohead' },
      { title: 'Enter Sandman', artist: 'Metallica' }
    ]);

    const result = service.getTracks({ search: 'radiohead' });
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0].title).toBe('Creep');
  });

  test('persists to disk and reloads', () => {
    service.addTracks({ title: 'Persisted', artist: 'Test' });
    const service2 = new CollectionService(tmpDir, wsManager);
    expect(service2.total).toBe(1);
    expect(service2.getTracks().tracks[0].title).toBe('Persisted');
  });
});
