const PlaylistService = require('../services/playlist-service');

function createMockStore() {
  const data = new Map();
  return {
    get: (key, def) => data.has(key) ? data.get(key) : def,
    set: (key, val) => data.set(key, val),
    delete: (key) => data.delete(key),
    has: (key) => data.has(key)
  };
}

function createMockWSManager() {
  return { broadcast: jest.fn(), send: jest.fn(), on: jest.fn(), off: jest.fn() };
}

describe('PlaylistService', () => {
  let service;
  let store;
  let wsManager;

  beforeEach(() => {
    store = createMockStore();
    wsManager = createMockWSManager();
    service = new PlaylistService(store, wsManager);
  });

  test('getAll returns empty array when no playlists', () => {
    expect(service.getAll()).toEqual([]);
  });

  test('save creates a new playlist', () => {
    service.save({ id: 'p1', name: 'My Playlist', tracks: [], addedAt: Date.now() });
    expect(service.getAll()).toHaveLength(1);
    expect(service.getAll()[0].name).toBe('My Playlist');
  });

  test('save updates existing playlist', () => {
    service.save({ id: 'p1', name: 'Original', tracks: [] });
    service.save({ id: 'p1', name: 'Updated', tracks: [{ title: 'Song' }] });
    expect(service.getAll()).toHaveLength(1);
    expect(service.getAll()[0].name).toBe('Updated');
  });

  test('save broadcasts update', () => {
    service.save({ id: 'p1', name: 'Test', tracks: [] });
    expect(wsManager.broadcast).toHaveBeenCalledWith('playlists:updated', expect.any(Array));
  });

  test('save throws without id', () => {
    expect(() => service.save({ name: 'No ID' })).toThrow('must have an id');
  });

  test('getById returns playlist or null', () => {
    service.save({ id: 'p1', name: 'Test', tracks: [] });
    expect(service.getById('p1').name).toBe('Test');
    expect(service.getById('missing')).toBeNull();
  });

  test('delete removes playlist', () => {
    service.save({ id: 'p1', name: 'Test', tracks: [] });
    service.delete('p1');
    expect(service.getAll()).toHaveLength(0);
  });

  test('delete throws for missing playlist', () => {
    expect(() => service.delete('missing')).toThrow('not found');
  });

  test('getAll sorts by addedAt descending', () => {
    service.save({ id: 'old', name: 'Old', tracks: [], addedAt: 1000 });
    service.save({ id: 'new', name: 'New', tracks: [], addedAt: 2000 });
    const all = service.getAll();
    expect(all[0].id).toBe('new');
    expect(all[1].id).toBe('old');
  });

  test('parseXspf validates content', () => {
    expect(() => service.parseXspf('not xml', 'test.xspf')).toThrow('Not a valid XSPF');
    const result = service.parseXspf('<playlist></playlist>', 'test.xspf');
    expect(result.filename).toBe('test.xspf');
  });

  test('exportXspf returns XSPF XML', () => {
    service.save({
      id: 'p1', name: 'Export Test', tracks: [
        { title: 'Song 1', artist: 'Artist 1', album: 'Album 1', duration: 180 }
      ]
    });
    const xspf = service.exportXspf('p1');
    expect(xspf).toContain('<?xml');
    expect(xspf).toContain('Export Test');
    expect(xspf).toContain('Song 1');
    expect(xspf).toContain('<duration>180000</duration>');
  });

  test('exportXspf throws for missing playlist', () => {
    expect(() => service.exportXspf('missing')).toThrow('not found');
  });
});
